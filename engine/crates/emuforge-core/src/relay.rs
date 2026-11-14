//! The relay of one AWS request to the emulator: [`prepare`] the head that goes on the wire (re-signed with the
//! emulator's key when the client signed it), [`forward`] it with the streamed body over one fresh connection,
//! and pass the emulator's answer back as a streamed [`RelayBody`]. Every wait has a deadline from [`Limits`].
//!
//! The engine never reads a request or response body: both are `http_body` streams, frame by frame.

use std::error::Error as StdError;
use std::fmt;
use std::future::{Future, pending};
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use bytes::Bytes;
use http::header::{AUTHORIZATION, CONNECTION, EXPECT, HOST, HeaderMap, HeaderName, HeaderValue};
use http::request::Parts;
use http::uri::PathAndQuery;
use http::{Extensions, Request, Response, Uri, Version};
use http_body::{Body, Frame, SizeHint};
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{Sleep, sleep};

use crate::connect::{CONNECT_DEADLINE, connect, from_files};
use crate::sigv4::{
    self, ALGORITHM, Auth, ClientAuth, SIGNED_CHUNK_MODES, UNSIGNED_PAYLOAD, UriMode, classify,
};
use crate::{Credentials, Emulator, EmulatorFiles, Reason};

/// An error a body passes on: the client's, hyper's, or the engine's own idle timeout.
pub type BoxError = Box<dyn StdError + Send + Sync>;

/// No byte from the client, no byte accepted by the emulator, no response head, or no response byte for this
/// long ends the exchange (D6).
const IDLE: Duration = Duration::from_secs(60);

const X_AMZ_CONTENT_SHA256: &str = "x-amz-content-sha256";
const X_AMZ_DATE: &str = "x-amz-date";
const X_AMZ_SECURITY_TOKEN: &str = "x-amz-security-token";
const KEEP_ALIVE: &str = "keep-alive";
const PROXY_CONNECTION: &str = "proxy-connection";
/// Hop-by-hop headers, removed in both directions, besides `Connection` itself and every header it names.
const HOP_BY_HOP: [&str; 7] = [
    KEEP_ALIVE,
    PROXY_CONNECTION,
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

const QUERY_CREDENTIAL: &str = "X-Amz-Credential";
const QUERY_SIGNED_HEADERS: &str = "X-Amz-SignedHeaders";
const QUERY_SIGNATURE: &str = "X-Amz-Signature";
const QUERY_SECURITY_TOKEN: &str = "X-Amz-Security-Token";

/// The deadlines of one relayed exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// TCP connect plus TLS handshake.
    pub connect: Duration,
    /// While the request body is sent: no byte from the client, or no byte accepted by the emulator.
    pub upload_idle: Duration,
    /// From the end of the request body to the response head.
    pub head: Duration,
    /// After the response head: no byte from the emulator.
    pub download_idle: Duration,
}

impl Limits {
    /// 2 s to connect, 60 s for every idle bound and the head (D6).
    pub const DEFAULT: Limits = Limits {
        connect: CONNECT_DEADLINE,
        upload_idle: IDLE,
        head: IDLE,
        download_idle: IDLE,
    };
}

/// Why the engine itself answers instead of the emulator. `Display` shows a code and a kind, never a key id, a
/// header value or a body byte.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RelayError {
    /// A signed-chunk upload mode, refused before anything is read or sent. `mode` is one of
    /// [`SIGNED_CHUNK_MODES`], never the received bytes.
    #[error("PayloadSigningNotSupported ({mode})")]
    PayloadSigningNotSupported { mode: &'static str },
    /// The emulator's files, the connection or the TLS handshake failed, or the emulator closed the connection
    /// before its response head.
    #[error("EmulatorUnavailable ({})", reason_text(.0))]
    Unavailable(Reason),
    /// No byte from the client's request body within the upload idle bound.
    #[error("RequestTimeout (client upload idle)")]
    ClientStalled,
    /// The emulator accepted no byte of the request body within the upload idle bound.
    #[error("EmulatorTimeout (emulator upload idle)")]
    EmulatorStalled,
    /// The client's request body ended in an error (a reset, malformed chunked framing).
    #[error("IncompleteBody (client body error)")]
    ClientBodyFailed,
    /// No response head within the head deadline after the request body was sent.
    #[error("EmulatorTimeout (no response head)")]
    HeadTimeout,
}

fn reason_text(reason: &Reason) -> String {
    match reason {
        Reason::ConnectionFailed { kind } => format!("{}: {kind}", reason.code()),
        other => other.code().to_owned(),
    }
}

/// The head that goes to the emulator. The body is never part of it.
pub struct Prepared {
    pub head: Parts,
}

/// The method and the header names only: the path, the query (a presigned URL's credential and signature)
/// and every header value stay out.
impl fmt::Debug for Prepared {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        struct Names<'a>(&'a HeaderMap);
        impl fmt::Debug for Names<'_> {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.debug_list()
                    .entries(self.0.keys().map(HeaderName::as_str))
                    .finish()
            }
        }
        f.debug_struct("Prepared")
            .field("method", &self.head.method.as_str())
            .field("headers", &Names(&self.head.headers))
            .finish()
    }
}

/// The request head as forwarded to `emulator`: origin-form target, `Host` set to the emulator, hop-by-hop
/// headers removed, and for a header-signed or query-signed request the session token removed and the
/// signature replaced by one made with `credentials`. Any other request keeps its `Authorization` (or its
/// absence) as received. A header-signed signed-chunk upload is refused.
pub fn prepare(
    parts: Parts,
    emulator: &Emulator,
    credentials: &Credentials,
) -> Result<Prepared, RelayError> {
    let auth = classify(&parts);
    refuse_signed_chunks(&auth, &parts.headers)?;
    prepare_classified(parts, auth, emulator, credentials)
}

/// Reads the emulator's files for this request, prepares the head, connects and forwards. A signed-chunk
/// upload is refused before any file is read.
pub async fn relay<B>(
    emulator: &Emulator,
    request: Request<B>,
    limits: &Limits,
) -> Result<Response<RelayBody>, RelayError>
where
    B: Body<Data = Bytes> + Send + Unpin + 'static,
    B::Error: Into<BoxError>,
{
    let (parts, body) = request.into_parts();
    let auth = classify(&parts);
    refuse_signed_chunks(&auth, &parts.headers)?;
    let files = EmulatorFiles::read(emulator)
        .await
        .map_err(|error| RelayError::Unavailable(from_files(error)))?;
    let prepared = prepare_classified(parts, auth, emulator, files.credentials())?;
    let upstream = connect(emulator, &files, limits.connect, limits.upload_idle)
        .await
        .map_err(RelayError::Unavailable)?;
    drop(files);
    forward(upstream.stream, upstream.stalled, prepared, body, limits).await
}

fn refuse_signed_chunks(auth: &Auth, headers: &HeaderMap) -> Result<(), RelayError> {
    if !matches!(auth, Auth::Header(_)) {
        return Ok(());
    }
    let Some(value) = headers.get(X_AMZ_CONTENT_SHA256) else {
        return Ok(());
    };
    match SIGNED_CHUNK_MODES
        .iter()
        .find(|mode| value.as_bytes() == mode.as_bytes())
    {
        Some(mode) => Err(RelayError::PayloadSigningNotSupported { mode }),
        None => Ok(()),
    }
}

fn prepare_classified(
    mut parts: Parts,
    auth: Auth,
    emulator: &Emulator,
    credentials: &Credentials,
) -> Result<Prepared, RelayError> {
    remove_hop_by_hop(&mut parts.headers);
    parts.headers.remove(EXPECT);
    parts
        .headers
        .insert(HOST, header_value(emulator.socket_addr().to_string())?);
    parts.version = Version::HTTP_11;
    parts.extensions = Extensions::new();
    let path_and_query = parts
        .uri
        .path_and_query()
        .cloned()
        .unwrap_or_else(|| PathAndQuery::from_static("/"));
    parts.uri = Uri::from(path_and_query);
    match auth {
        Auth::Header(client) => sign_header(&mut parts, &client, credentials)?,
        Auth::Query(client) => sign_query(&mut parts, &client, credentials)?,
        Auth::Other => {}
    }
    Ok(Prepared { head: parts })
}

/// `Connection` and every header it names, then the fixed hop-by-hop list.
fn remove_hop_by_hop(headers: &mut HeaderMap) {
    let mut named: Vec<HeaderName> = Vec::new();
    named.extend(
        headers
            .get_all(CONNECTION)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok()),
    );
    headers.remove(CONNECTION);
    for name in named {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(name);
    }
}

/// The client's signed headers still present, plus `required`, sorted and without duplicates.
fn signed_headers(client: &ClientAuth, headers: &HeaderMap, required: &[&str]) -> Vec<HeaderName> {
    let mut names: Vec<HeaderName> = Vec::new();
    names.extend(
        client
            .signed_headers
            .iter()
            .filter(|name| headers.contains_key(*name))
            .cloned(),
    );
    names.extend(
        required
            .iter()
            .filter_map(|name| HeaderName::from_bytes(name.as_bytes()).ok()),
    );
    names.sort_unstable_by(|a, b| a.as_str().cmp(b.as_str()));
    names.dedup();
    names
}

/// The names joined with `;`, as `SignedHeaders` lists them.
fn joined(names: &[HeaderName]) -> String {
    let mut list = String::new();
    for name in names {
        if !list.is_empty() {
            list.push(';');
        }
        list.push_str(name.as_str());
    }
    list
}

fn uri_mode(client: &ClientAuth) -> UriMode {
    if client.scope.service == "s3" {
        UriMode::AsSent
    } else {
        UriMode::EncodeSegments
    }
}

/// `<emulator access key id>/<client scope>`.
fn credential(client: &ClientAuth, credentials: &Credentials) -> String {
    format!(
        "{}/{}",
        credentials.access_key_id.expose(),
        sigv4::scope_text(&client.scope)
    )
}

fn sign(
    parts: &Parts,
    raw_query: &str,
    client: &ClientAuth,
    signed: &[HeaderName],
    payload_hash: &str,
    credentials: &Credentials,
) -> String {
    let canonical = sigv4::canonical_request(
        &parts.method,
        parts.uri.path(),
        raw_query,
        &parts.headers,
        signed,
        payload_hash,
        uri_mode(client),
    );
    let string_to_sign = sigv4::string_to_sign(&client.amz_date, &client.scope, &canonical);
    sigv4::signature(
        &credentials.secret_access_key,
        &client.scope,
        &string_to_sign,
    )
}

fn sign_header(
    parts: &mut Parts,
    client: &ClientAuth,
    credentials: &Credentials,
) -> Result<(), RelayError> {
    parts.headers.remove(X_AMZ_SECURITY_TOKEN);
    parts.headers.remove(AUTHORIZATION);
    let received_hash = parts
        .headers
        .get(X_AMZ_CONTENT_SHA256)
        .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
    let (payload_hash, required): (String, &[&str]) = match received_hash {
        Some(hash) => (hash, &["host", X_AMZ_DATE]),
        None => {
            parts.headers.insert(
                X_AMZ_CONTENT_SHA256,
                HeaderValue::from_static(UNSIGNED_PAYLOAD),
            );
            (
                UNSIGNED_PAYLOAD.to_owned(),
                &["host", X_AMZ_DATE, X_AMZ_CONTENT_SHA256],
            )
        }
    };
    let signed = signed_headers(client, &parts.headers, required);
    let raw_query = parts.uri.query().unwrap_or("").to_owned();
    let signature = sign(
        parts,
        &raw_query,
        client,
        &signed,
        &payload_hash,
        credentials,
    );
    let authorization = format!(
        "{ALGORITHM} Credential={}, SignedHeaders={}, Signature={signature}",
        credential(client, credentials),
        joined(&signed)
    );
    parts
        .headers
        .insert(AUTHORIZATION, header_value(authorization)?);
    Ok(())
}

/// Rebuilds the query from its raw parameters in their order: the credential and the signed header list
/// replaced, the session token dropped, the signature replaced in its place. Every other parameter keeps its
/// bytes.
fn sign_query(
    parts: &mut Parts,
    client: &ClientAuth,
    credentials: &Credentials,
) -> Result<(), RelayError> {
    parts.headers.remove(X_AMZ_SECURITY_TOKEN);
    let signed = signed_headers(client, &parts.headers, &["host"]);
    let raw_query = parts.uri.query().unwrap_or("");
    let mut kept: Vec<String> = Vec::new();
    let mut signature_at = None;
    for pair in raw_query.split('&') {
        let raw_name = pair.split_once('=').map_or(pair, |(name, _)| name);
        let name = percent_decode(raw_name);
        if name == QUERY_CREDENTIAL.as_bytes() {
            kept.push(format!(
                "{raw_name}={}",
                uri_encode(&credential(client, credentials))
            ));
        } else if name == QUERY_SIGNED_HEADERS.as_bytes() {
            kept.push(format!("{raw_name}={}", uri_encode(&joined(&signed))));
        } else if name == QUERY_SECURITY_TOKEN.as_bytes() {
            continue;
        } else if name == QUERY_SIGNATURE.as_bytes() {
            signature_at = Some((kept.len(), raw_name.to_owned()));
        } else {
            kept.push(pair.to_owned());
        }
    }
    let unsigned_query = kept.join("&");
    let signature = sign(
        parts,
        &unsigned_query,
        client,
        &signed,
        UNSIGNED_PAYLOAD,
        credentials,
    );
    if let Some((index, raw_name)) = signature_at {
        kept.insert(index, format!("{raw_name}={signature}"));
    }
    let target = format!("{}?{}", parts.uri.path(), kept.join("&"));
    parts.uri = PathAndQuery::try_from(target)
        .map(Uri::from)
        .map_err(|_| invalid_request())?;
    Ok(())
}

/// The only bytes the engine adds to a head are the emulator's socket address, its access key id, scopes and
/// hex signatures; a value that is not a valid header is an engine defect, reported like #1's builder failures.
fn header_value(text: String) -> Result<HeaderValue, RelayError> {
    HeaderValue::try_from(text).map_err(|_| invalid_request())
}

fn invalid_request() -> RelayError {
    RelayError::Unavailable(Reason::ConnectionFailed {
        kind: "http".into(),
    })
}

/// Every byte outside `A-Z a-z 0-9 - . _ ~` as `%XX`, upper-case hex (the SigV4 query encoding).
fn uri_encode(text: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(text.len());
    for &byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX[usize::from(byte >> 4)]));
            out.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    out
}

/// `%XX` decoded; a `%` not followed by two hex digits is kept as it is (as `classify` reads names).
fn percent_decode(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let hex = |index: usize| -> Option<u8> {
        let digit = |at: usize| {
            bytes
                .get(at)
                .and_then(|byte| char::from(*byte).to_digit(16))
        };
        u8::try_from(digit(index + 1)? << 4 | digit(index + 2)?).ok()
    };
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match (bytes[index], hex(index)) {
            (b'%', Some(byte)) => {
                out.push(byte);
                index += 3;
            }
            (byte, _) => {
                out.push(byte);
                index += 1;
            }
        }
    }
    out
}

/// One exchange over `stream`: the prepared head and the streamed `body`, then the emulator's response head
/// within the deadlines of `limits`. `upstream_stalled` is the flag of the [`crate::IdleWrite`] under `stream`.
///
/// The connection is driven by one spawned task owned by the returned [`RelayBody`] (or by this future until
/// then); dropping either aborts it and closes the connection. Nothing is reused for another exchange.
pub async fn forward<S, B>(
    stream: S,
    upstream_stalled: Arc<AtomicBool>,
    prepared: Prepared,
    body: B,
    limits: &Limits,
) -> Result<Response<RelayBody>, RelayError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    B: Body<Data = Bytes> + Send + Unpin + 'static,
    B::Error: Into<BoxError>,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| RelayError::Unavailable(connection_failed(&error)))?;
    let task = AbortOnDrop(tokio::spawn(async move {
        // The outcome reaches the caller through `send_request` or the response body.
        let _ = connection.await;
    }));

    let (sent_tx, mut sent_rx) = watch::channel(false);
    let client = Arc::new(ClientOutcome::default());
    let upload = UploadBody::new(body, limits.upload_idle, sent_tx, Arc::clone(&client));
    let request = Request::from_parts(prepared.head, upload);
    let head_deadline = async {
        if sent_rx.wait_for(|sent| *sent).await.is_err() {
            // The upload was dropped unfinished: the request fails on its own.
            pending::<()>().await;
        }
        sleep(limits.head).await;
    };

    let answer = tokio::select! {
        answer = sender.send_request(request) => answer,
        () = head_deadline => return Err(RelayError::HeadTimeout),
    };
    let response = answer.map_err(|error| {
        if client.stalled.load(Ordering::Acquire) {
            RelayError::ClientStalled
        } else if client.failed.load(Ordering::Acquire) {
            RelayError::ClientBodyFailed
        } else if upstream_stalled.load(Ordering::Acquire) {
            RelayError::EmulatorStalled
        } else {
            RelayError::Unavailable(connection_failed(&error))
        }
    })?;

    let upload_ended = *sent_rx.borrow();
    let (mut parts, incoming) = response.into_parts();
    remove_hop_by_hop(&mut parts.headers);
    if !upload_ended {
        // An early answer: the client connection is closed after it, its body is not read further.
        parts
            .headers
            .insert(CONNECTION, HeaderValue::from_static("close"));
    }
    let body = RelayBody {
        incoming,
        idle: limits.download_idle,
        sleep: None,
        _task: task,
    };
    Ok(Response::from_parts(parts, body))
}

/// The io error kind under a hyper error, or what hyper says about the connection.
fn connection_failed(error: &hyper::Error) -> Reason {
    let mut source = error.source();
    while let Some(inner) = source {
        if let Some(io_error) = inner.downcast_ref::<io::Error>() {
            return Reason::ConnectionFailed {
                kind: io_error.kind().to_string(),
            };
        }
        source = inner.source();
    }
    let kind = if error.is_incomplete_message() || error.is_closed() || error.is_canceled() {
        "connection closed"
    } else {
        "http"
    };
    Reason::ConnectionFailed { kind: kind.into() }
}

/// Aborts the connection task when the exchange or its body is dropped.
struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// How the client's body ended, if it ended badly.
#[derive(Default)]
struct ClientOutcome {
    stalled: AtomicBool,
    failed: AtomicBool,
}

/// True once `sleep` (armed on the first call) has fired; the caller disarms it on progress.
fn idle_elapsed(timer: &mut Option<Pin<Box<Sleep>>>, idle: Duration, cx: &mut Context<'_>) -> bool {
    let fired = timer
        .get_or_insert_with(|| Box::pin(sleep(idle)))
        .as_mut()
        .poll(cx)
        .is_ready();
    if fired {
        *timer = None;
    }
    fired
}

fn timed_out(what: &'static str) -> BoxError {
    Box::new(io::Error::new(io::ErrorKind::TimedOut, what))
}

/// The client's body on its way up: unchanged frames, an error after `idle` without a frame, and `sent` set
/// once the last frame was handed over.
struct UploadBody<B> {
    inner: B,
    idle: Duration,
    sleep: Option<Pin<Box<Sleep>>>,
    sent: watch::Sender<bool>,
    client: Arc<ClientOutcome>,
}

impl<B: Body> UploadBody<B> {
    fn new(
        inner: B,
        idle: Duration,
        sent: watch::Sender<bool>,
        client: Arc<ClientOutcome>,
    ) -> Self {
        if inner.is_end_stream() {
            // hyper never polls an empty body: the head deadline starts now.
            sent.send_replace(true);
        }
        UploadBody {
            inner,
            idle,
            sleep: None,
            sent,
            client,
        }
    }
}

impl<B> Body for UploadBody<B>
where
    B: Body<Data = Bytes> + Unpin,
    B::Error: Into<BoxError>,
{
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, BoxError>>> {
        let this = self.get_mut();
        match Pin::new(&mut this.inner).poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                this.sleep = None;
                if this.inner.is_end_stream() {
                    this.sent.send_replace(true);
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(error))) => {
                this.sleep = None;
                this.client.failed.store(true, Ordering::Release);
                Poll::Ready(Some(Err(error.into())))
            }
            Poll::Ready(None) => {
                this.sleep = None;
                this.sent.send_replace(true);
                Poll::Ready(None)
            }
            Poll::Pending => {
                if idle_elapsed(&mut this.sleep, this.idle, cx) {
                    this.client.stalled.store(true, Ordering::Release);
                    Poll::Ready(Some(Err(timed_out(
                        "no request body byte arrived within the upload idle bound",
                    ))))
                } else {
                    Poll::Pending
                }
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

/// The emulator's response body, streamed: unchanged frames, an error after the download idle bound without
/// one. Dropping it aborts the connection task.
pub struct RelayBody {
    incoming: Incoming,
    idle: Duration,
    sleep: Option<Pin<Box<Sleep>>>,
    _task: AbortOnDrop,
}

impl fmt::Debug for RelayBody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayBody").finish_non_exhaustive()
    }
}

impl Body for RelayBody {
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, BoxError>>> {
        let this = self.get_mut();
        match Pin::new(&mut this.incoming).poll_frame(cx) {
            Poll::Ready(frame) => {
                this.sleep = None;
                Poll::Ready(frame.map(|result| result.map_err(BoxError::from)))
            }
            Poll::Pending if idle_elapsed(&mut this.sleep, this.idle, cx) => {
                Poll::Ready(Some(Err(timed_out(
                    "the emulator sent no response byte within the download idle bound",
                ))))
            }
            Poll::Pending => Poll::Pending,
        }
    }

    fn is_end_stream(&self) -> bool {
        self.incoming.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.incoming.size_hint()
    }
}
