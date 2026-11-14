//! AWS requests as a third-party client sends them (requirement §2), signed with the reference signer
//! (`aws-sigv4`, the AWS SDK for Rust's signer, independent of the engine's code), to either endpoint:
//!
//! - the engine, `http://127.0.0.1:<engine port>`, over plain TCP;
//! - the emulator, `https://127.0.0.1:<emulator port>`, over TLS that trusts only its `ca.pem` (read on every
//!   request, since a restart writes a new one).
//!
//! HTTP/1.1, one request per connection (`Connection: close`). Request bodies are written in 64 KiB writes,
//! after `100 Continue` when `Expect: 100-continue` is sent; responses are read in 64 KiB reads and framed by
//! `Content-Length`, chunked encoding or the close of the connection.

use std::borrow::Cow;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use aws_credential_types::Credentials;
use aws_sigv4::http_request::{
    PayloadChecksumKind, PercentEncodingMode, SignableBody, SignableRequest, SignatureLocation,
    SigningSettings, UriPathNormalizationMode, sign,
};
use aws_sigv4::sign::v4;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, IpAddr as PkiIpAddr, ServerName};
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

use crate::support::check::{Ctx, Env};
use crate::support::emulator::{EmulatorFiles, emulator_dir};
use crate::support::http::Response;
use crate::support::net::connect;

/// Size of every body write and read.
pub const CHUNK: usize = 64 * 1024;

/// A peer that sends no byte for this long while an answer is awaited has failed to answer.
pub const IDLE_BOUND: Duration = Duration::from_secs(5);

/// Upper bound for one whole exchange, 32 MiB bodies included.
pub const EXCHANGE_BOUND: Duration = Duration::from_secs(120);

/// The region every request is signed for.
pub const REGION: &str = "us-east-1";

/// The check key of `test-criteria.md`: an access key id the emulator does not know, with a made-up secret.
pub const CHECK_ACCESS_KEY_ID: &str = "AKIAEMUFORGECHECK001";
const CHECK_SECRET: &str = "emuforgeCheckSecretKey0000000000000000000";

/// A signing key. No `Debug`: the secret is never printed.
#[derive(Clone)]
pub struct Key {
    pub access_key_id: String,
    secret_access_key: String,
    pub session_token: Option<String>,
}

impl Key {
    /// The check key: the engine accepts it, the emulator refuses it.
    pub fn check() -> Key {
        Key {
            access_key_id: CHECK_ACCESS_KEY_ID.to_owned(),
            secret_access_key: CHECK_SECRET.to_owned(),
            session_token: None,
        }
    }

    /// The emulator's own key, from its `emulator_credentials` (registered for redaction when read).
    pub fn emulator(files: &EmulatorFiles) -> Key {
        Key {
            access_key_id: files.access_key_id.clone(),
            secret_access_key: files.secret_access_key.clone(),
            session_token: None,
        }
    }

    /// The emulator key of the emulator on `port` under `ctx.home`, read now.
    pub fn of_emulator(ctx: &Ctx, port: u16) -> Result<Key, Env> {
        EmulatorFiles::read(&emulator_dir(&ctx.home, port))
            .map(|files| Key::emulator(&files))
            .ok_or_else(|| {
                Env::new(format!(
                    "the files of the emulator on port {port} are missing or incomplete"
                ))
            })
    }

    /// The same key with a session token, sent as `X-Amz-Security-Token` and signed.
    pub fn with_session_token(mut self, token: &str) -> Key {
        self.session_token = Some(token.to_owned());
        self
    }
}

/// Where a request goes.
#[derive(Clone)]
pub enum Endpoint {
    /// `http://127.0.0.1:<port>`: the engine under test.
    Engine(u16),
    /// `https://127.0.0.1:<port>`, trusting only `ca`: an emulator, bypassing the engine.
    Emulator { port: u16, ca: PathBuf },
}

impl Endpoint {
    pub fn engine(ctx: &Ctx) -> Endpoint {
        Endpoint::Engine(ctx.engine_port)
    }

    /// The run's emulator.
    pub fn emulator(ctx: &Ctx) -> Endpoint {
        Endpoint::emulator_on(ctx, ctx.emulator_port)
    }

    pub fn emulator_on(ctx: &Ctx, port: u16) -> Endpoint {
        Endpoint::Emulator {
            port,
            ca: emulator_dir(&ctx.home, port).join("ca.pem"),
        }
    }

    pub fn port(&self) -> u16 {
        match self {
            Endpoint::Engine(port) | Endpoint::Emulator { port, .. } => *port,
        }
    }

    /// `127.0.0.1:<port>`, the `Host` a client configured with this endpoint sends.
    pub fn host(&self) -> String {
        format!("127.0.0.1:{}", self.port())
    }

    fn name(&self) -> &'static str {
        match self {
            Endpoint::Engine(_) => "engine",
            Endpoint::Emulator { .. } => "emulator",
        }
    }
}

/// What `X-Amz-Content-SHA256` carries on a header-signed request.
#[derive(Clone)]
pub enum Payload {
    /// No `X-Amz-Content-SHA256` (JSON, query and REST-JSON clients).
    Absent,
    /// The SHA-256 of the body sent.
    BodyHash,
    /// The SHA-256 of other bytes than the body sent.
    HashOf(Vec<u8>),
    /// A literal value: `UNSIGNED-PAYLOAD`, `STREAMING-…`.
    Literal(String),
}

/// How a request is authenticated.
#[derive(Clone)]
pub enum Auth {
    /// `Authorization: AWS4-HMAC-SHA256 …` with `X-Amz-Date`.
    Header,
    /// A presigned URL valid for `expires` from the signing time.
    Query { expires: Duration },
    /// No signature at all; any `Authorization` the call sets with `unsigned_header` is sent as it is.
    Unsigned,
}

/// One AWS request, before it is signed for an endpoint.
#[derive(Clone)]
pub struct Call {
    pub method: String,
    /// Path and query, exactly as sent.
    pub target: String,
    pub service: &'static str,
    /// Sent and, when the call is signed, signed.
    headers: Vec<(String, String)>,
    /// Sent, never signed.
    unsigned_headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    payload: Payload,
    auth: Auth,
    at: Option<SystemTime>,
    expect_continue: bool,
}

impl Call {
    /// A header-signed request with no `X-Amz-Content-SHA256` and an empty body.
    pub fn new(service: &'static str, method: &str, target: &str) -> Call {
        Call {
            method: method.to_owned(),
            target: target.to_owned(),
            service,
            headers: Vec::new(),
            unsigned_headers: Vec::new(),
            body: Vec::new(),
            payload: Payload::Absent,
            auth: Auth::Header,
            at: None,
            expect_continue: false,
        }
    }

    /// An S3 request as the AWS CLI sends it: header-signed, `X-Amz-Content-SHA256` the body's hash.
    pub fn s3(method: &str, target: &str) -> Call {
        Call::new("s3", method, target).payload(Payload::BodyHash)
    }

    /// A JSON-protocol request (`X-Amz-Target`, `application/x-amz-json-1.0`), as the AWS CLI sends it.
    pub fn json(service: &'static str, target: &str, body: &str) -> Call {
        Call::new(service, "POST", "/")
            .header("Content-Type", "application/x-amz-json-1.0")
            .header("X-Amz-Target", target)
            .body(body.as_bytes().to_vec())
    }

    /// A query-protocol request: a form `POST /`, as the AWS CLI sends it.
    pub fn query(service: &'static str, form: &str) -> Call {
        Call::new(service, "POST", "/")
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=utf-8",
            )
            .body(form.as_bytes().to_vec())
    }

    pub fn header(mut self, name: &str, value: &str) -> Call {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn unsigned_header(mut self, name: &str, value: &str) -> Call {
        self.unsigned_headers
            .push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn body(mut self, body: Vec<u8>) -> Call {
        self.body = body;
        self
    }

    pub fn payload(mut self, payload: Payload) -> Call {
        self.payload = payload;
        self
    }

    pub fn query_signed(mut self, expires: Duration) -> Call {
        self.auth = Auth::Query { expires };
        self
    }

    pub fn unsigned(mut self) -> Call {
        self.auth = Auth::Unsigned;
        self
    }

    /// Signs with this time instead of now (`X-Amz-Date`).
    pub fn at(mut self, at: SystemTime) -> Call {
        self.at = Some(at);
        self
    }

    /// Sends `Expect: 100-continue` and writes the body only after `100 Continue`.
    pub fn expect_continue(mut self) -> Call {
        self.expect_continue = true;
        self
    }

    /// Signs the call for `endpoint` with `key` (unless it is unsigned), sends it and reads the whole answer.
    pub fn send(&self, ctx: &Ctx, endpoint: &Endpoint, key: &Key) -> io::Result<Response> {
        let host = endpoint.host();
        let (auth_headers, target) = self.sign_for(&host, key)?;
        let mut head = format!("{} {} HTTP/1.1\r\nHost: {host}\r\n", self.method, target);
        let all = self
            .headers
            .iter()
            .chain(&auth_headers)
            .chain(&self.unsigned_headers);
        for (name, value) in all {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        if !self.body.is_empty() || matches!(self.method.as_str(), "PUT" | "POST") {
            head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        }
        if self.expect_continue {
            head.push_str("Expect: 100-continue\r\n");
        }
        head.push_str("Connection: close\r\n\r\n");

        let started = Instant::now();
        let mut conn = Conn::open(ctx, endpoint)?;
        let answer = exchange(
            &mut conn,
            head.as_bytes(),
            &self.body,
            self.expect_continue,
            self.method == "HEAD",
            started,
        );
        let shown_target = target.split('?').next().unwrap_or_default();
        match &answer {
            Ok(r) => ctx.log(format!(
                "{} {shown_target}{} to the {} -> {} ({} body bytes) in {} ms",
                self.method,
                if target.contains('?') { "?…" } else { "" },
                endpoint.name(),
                r.status,
                r.body.len(),
                r.elapsed.as_millis()
            )),
            Err(e) => ctx.log(format!(
                "{} {shown_target} to the {} -> no answer: {e}",
                self.method,
                endpoint.name()
            )),
        }
        answer
    }

    /// The headers the signature adds and the request target with any query signature appended.
    fn sign_for(&self, host: &str, key: &Key) -> io::Result<(Vec<(String, String)>, String)> {
        let (location, expires) = match &self.auth {
            Auth::Unsigned => return Ok((Vec::new(), self.target.clone())),
            Auth::Header => (SignatureLocation::Headers, None),
            Auth::Query { expires } => (SignatureLocation::QueryParams, Some(*expires)),
        };
        let invalid = |e: &dyn std::fmt::Display| {
            io::Error::new(io::ErrorKind::InvalidInput, format!("cannot sign: {e}"))
        };
        let mut settings = SigningSettings::default();
        settings.signature_location = location;
        settings.expires_in = expires;
        if self.service == "s3" {
            settings.percent_encoding_mode = PercentEncodingMode::Single;
            settings.uri_path_normalization_mode = UriPathNormalizationMode::Disabled;
        }
        let other_hash_source;
        let body = match (&self.auth, &self.payload) {
            (Auth::Query { .. }, _) => SignableBody::UnsignedPayload,
            (_, Payload::Absent) => SignableBody::Bytes(&self.body),
            (_, Payload::BodyHash) => {
                settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
                SignableBody::Bytes(&self.body)
            }
            (_, Payload::HashOf(other)) => {
                settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
                other_hash_source = other.clone();
                SignableBody::Bytes(&other_hash_source)
            }
            (_, Payload::Literal(value)) => {
                settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
                SignableBody::Precomputed(value.clone())
            }
        };
        let identity = Credentials::new(
            key.access_key_id.clone(),
            key.secret_access_key.clone(),
            key.session_token.clone(),
            None,
            "emuforge-integration",
        )
        .into();
        let params = v4::SigningParams::builder()
            .identity(&identity)
            .region(REGION)
            .name(self.service)
            .time(self.at.unwrap_or_else(SystemTime::now))
            .settings(settings)
            .build()
            .map_err(|e| invalid(&e))?
            .into();
        let mut signed: Vec<(&str, &str)> = vec![("host", host)];
        signed.extend(self.headers.iter().map(|(n, v)| (n.as_str(), v.as_str())));
        let uri = format!("http://{host}{}", self.target);
        let request = SignableRequest::new(&self.method, Cow::Owned(uri), signed.into_iter(), body)
            .map_err(|e| invalid(&e))?;
        let (instructions, _) = sign(request, &params)
            .map_err(|e| invalid(&e))?
            .into_parts();
        let (headers, query) = instructions.into_parts();
        let headers = headers
            .iter()
            .map(|h| (h.name().to_owned(), h.value().to_owned()))
            .collect();
        let mut target = self.target.clone();
        for (i, (name, value)) in query.iter().enumerate() {
            let sep = if i == 0 && !target.contains('?') {
                '?'
            } else {
                '&'
            };
            target.push(sep);
            target.push_str(&percent_encode(name));
            target.push('=');
            target.push_str(&percent_encode(value));
        }
        Ok((headers, target))
    }
}

/// Percent-encodes everything but the unreserved characters of RFC 3986, as SigV4 does for query values.
pub fn percent_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

enum Conn {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Conn {
    fn open(ctx: &Ctx, endpoint: &Endpoint) -> io::Result<Conn> {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, endpoint.port()));
        let socket = connect(ctx, addr)?;
        socket.set_write_timeout(Some(IDLE_BOUND))?;
        match endpoint {
            Endpoint::Engine(_) => Ok(Conn::Plain(socket)),
            Endpoint::Emulator { ca, .. } => {
                let config = tls_config(ca)?;
                let name = ServerName::IpAddress(PkiIpAddr::from(std::net::IpAddr::V4(
                    Ipv4Addr::LOCALHOST,
                )));
                let tls = ClientConnection::new(config, name)
                    .map_err(|e| io::Error::other(format!("TLS: {e}")))?;
                Ok(Conn::Tls(Box::new(StreamOwned::new(tls, socket))))
            }
        }
    }

    fn socket(&self) -> &TcpStream {
        match self {
            Conn::Plain(s) => s,
            Conn::Tls(s) => &s.sock,
        }
    }
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.read(buf),
            Conn::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(s) => s.write(buf),
            Conn::Tls(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(s) => s.flush(),
            Conn::Tls(s) => s.flush(),
        }
    }
}

/// A client configuration that trusts only the certificates in `ca` (ring provider, no platform roots).
fn tls_config(ca: &std::path::Path) -> io::Result<Arc<ClientConfig>> {
    let mut roots = RootCertStore::empty();
    for cert in CertificateDer::pem_file_iter(ca)
        .map_err(|e| io::Error::other(format!("cannot read {}: {e}", ca.display())))?
    {
        let cert =
            cert.map_err(|e| io::Error::other(format!("bad PEM in {}: {e}", ca.display())))?;
        roots
            .add(cert)
            .map_err(|e| io::Error::other(format!("bad certificate in {}: {e}", ca.display())))?;
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| io::Error::other(format!("TLS: {e}")))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

fn timed_out(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, what.to_owned())
}

/// Reads once into `raw`. `Ok(false)` at the end of the stream (a TLS peer that closes without
/// `close_notify` counts as the end too).
fn read_more(conn: &mut Conn, raw: &mut Vec<u8>, started: Instant) -> io::Result<bool> {
    let left = EXCHANGE_BOUND.saturating_sub(started.elapsed());
    if left.is_zero() {
        return Err(timed_out("no complete answer within the exchange bound"));
    }
    conn.socket().set_read_timeout(Some(IDLE_BOUND.min(left)))?;
    let mut buf = vec![0u8; CHUNK];
    match conn.read(&mut buf) {
        Ok(0) => Ok(false),
        Ok(n) => {
            raw.extend_from_slice(&buf[..n]);
            Ok(true)
        }
        Err(e)
            if matches!(
                e.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
            ) =>
        {
            Err(timed_out(&format!(
                "no byte for {} s",
                IDLE_BOUND.as_secs()
            )))
        }
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) if e.kind() == io::ErrorKind::ConnectionReset && !raw.is_empty() => Ok(false),
        Err(e) => Err(e),
    }
}

fn head_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|w| w == b"\r\n\r\n")
}

fn status_of(head: &[u8]) -> io::Result<u16> {
    let line = head.split(|b| *b == b'\r').next().unwrap_or_default();
    let line = String::from_utf8_lossy(line);
    line.split(' ')
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|_| line.starts_with("HTTP/1."))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "malformed status line"))
}

/// Writes the head, then the body (after `100 Continue` when `expect`), then reads the answer. A final answer
/// that arrives before the body is written ends the upload; so does a peer that stops reading it.
fn exchange(
    conn: &mut Conn,
    head: &[u8],
    body: &[u8],
    expect: bool,
    head_request: bool,
    started: Instant,
) -> io::Result<Response> {
    conn.write_all(head)?;
    conn.flush()?;
    let mut raw = Vec::new();
    let mut send_body = true;
    if expect {
        loop {
            if let Some(end) = head_end(&raw) {
                if status_of(&raw)? == 100 {
                    raw.drain(..end + 4);
                } else {
                    send_body = false;
                }
                break;
            }
            if !read_more(conn, &mut raw, started)? {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "closed before 100 Continue or an answer",
                ));
            }
        }
    }
    if send_body && !body.is_empty() {
        let mut written = Ok(());
        for chunk in body.chunks(CHUNK) {
            written = conn.write_all(chunk).and_then(|_| conn.flush());
            if written.is_err() {
                break;
            }
        }
        if let Err(e) = written {
            // The peer may have answered and closed before taking the whole body.
            return read_response(conn, raw, head_request, started).map_err(|_| e);
        }
    }
    read_response(conn, raw, head_request, started)
}

enum Framing {
    Length(usize),
    Chunked,
    Close,
}

/// Reads until the answer in `raw` is complete; skips interim `1xx` answers.
fn read_response(
    conn: &mut Conn,
    mut raw: Vec<u8>,
    head_request: bool,
    started: Instant,
) -> io::Result<Response> {
    let bad = |what: &str| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("malformed answer: {what}"),
        )
    };
    loop {
        if let Some(end) = head_end(&raw) {
            let status = status_of(&raw)?;
            if (100..200).contains(&status) {
                raw.drain(..end + 4);
                continue;
            }
            let head =
                std::str::from_utf8(&raw[..end]).map_err(|_| bad("headers are not UTF-8"))?;
            let headers: Vec<(String, String)> = head
                .split("\r\n")
                .skip(1)
                .filter_map(|l| l.split_once(':'))
                .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_owned()))
                .collect();
            let find = |name: &str| {
                headers
                    .iter()
                    .find(|(n, _)| n == name)
                    .map(|(_, v)| v.clone())
            };
            let framing = if head_request || status == 204 || status == 304 {
                Framing::Length(0)
            } else if find("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
                Framing::Chunked
            } else if let Some(length) = find("content-length") {
                Framing::Length(length.parse().map_err(|_| bad("content-length"))?)
            } else {
                Framing::Close
            };
            let start = end + 4;
            loop {
                let rest = &raw[start..];
                let complete = match framing {
                    Framing::Length(n) if rest.len() >= n => Some(rest[..n].to_vec()),
                    Framing::Chunked => dechunk(rest).transpose().map_err(|_| bad("chunks"))?,
                    _ => None,
                };
                if let Some(body) = complete {
                    return Ok(Response {
                        status,
                        headers,
                        body,
                        elapsed: started.elapsed(),
                    });
                }
                if !read_more(conn, &mut raw, started)? {
                    if matches!(framing, Framing::Close) {
                        return Ok(Response {
                            status,
                            headers,
                            body: raw[start..].to_vec(),
                            elapsed: started.elapsed(),
                        });
                    }
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        format!(
                            "closed after {} body bytes, before the end of the body",
                            raw.len() - start
                        ),
                    ));
                }
            }
        }
        if !read_more(conn, &mut raw, started)? {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                format!(
                    "closed after {} bytes, before the end of the headers",
                    raw.len()
                ),
            ));
        }
    }
}

/// The decoded body when `rest` holds a complete chunked body, `None` when more bytes are needed, `Some(Err)`
/// when the framing is malformed. Only chunk sizes are scanned until the body is complete; the data is copied
/// once, at the end.
fn dechunk(rest: &[u8]) -> Option<Result<Vec<u8>, ()>> {
    let mut chunks = Vec::new();
    let mut at = 0;
    loop {
        let line_end = at + rest[at..].windows(2).position(|w| w == b"\r\n")?;
        let size = std::str::from_utf8(&rest[at..line_end])
            .ok()
            .and_then(|t| usize::from_str_radix(t.split(';').next()?.trim(), 16).ok());
        let Some(size) = size else {
            return Some(Err(()));
        };
        at = line_end + 2;
        if size == 0 {
            // Trailers, then an empty line.
            loop {
                let line_end = rest[at..].windows(2).position(|w| w == b"\r\n")?;
                if line_end == 0 {
                    let mut body = Vec::with_capacity(chunks.iter().map(|(_, n)| n).sum());
                    for (from, n) in chunks {
                        body.extend_from_slice(&rest[from..from + n]);
                    }
                    return Some(Ok(body));
                }
                at += line_end + 2;
            }
        }
        if rest.len() < at + size + 2 {
            return None;
        }
        chunks.push((at, size));
        at += size + 2;
    }
}
