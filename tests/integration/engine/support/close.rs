//! The close client (test-criteria.md "Terms", issue 22): one request per connection, sent the way a client
//! that finishes its upload sends it, with each part of the outcome reported on its own so a check can tell a
//! write error, the answer and the end of the stream apart.
//!
//! - It opens one connection: plain TCP to the engine, TLS to an emulator trusting only its `ca.pem`.
//! - It sets the socket's read and write timeouts once, before the first byte is written, and never again, so no
//!   `setsockopt` call comes after the peer has reset the connection.
//! - It writes the head as given (it always carries `Connection: close`), then the whole body in 64 KiB writes,
//!   then reads until the stream ends. A write error stops the writes; the reads still happen.
//! - Every exchange is bounded by `EXCHANGE_BOUND`; each read and write by `IDLE_BOUND`.
//!
//! `support/aws.rs` keeps its signer and TLS setup to itself, and it is not changed by this issue (D1). So the head
//! of a request through the engine is recorded from a `Call` with a `RequestRecorder` before the engine starts
//! (signed with the check key), and the head of a request straight to an emulator is signed here with that
//! emulator's key (`direct_head`).

use std::borrow::Cow;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
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

use crate::support::aws::{CHUNK, EXCHANGE_BOUND, Endpoint, IDLE_BOUND, REGION};
use crate::support::check::{Ctx, Env};
use crate::support::emulator::{EmulatorFiles, emulator_dir};
use crate::support::http::Response;
use crate::support::net::connect;

/// How the stream ended after the client stopped writing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum End {
    /// A read returned the end of the stream (for TLS also a peer that closes without `close_notify`).
    Eof,
    /// A read failed with a reset (`ECONNRESET`, `ECONNABORTED`, `EPIPE`).
    Reset,
    /// No byte for `IDLE_BOUND`, or the exchange bound passed.
    Timeout,
    /// A read failed otherwise; the error as text.
    Other(String),
}

impl End {
    pub fn name(&self) -> String {
        match self {
            End::Eof => "eof".to_owned(),
            End::Reset => "reset".to_owned(),
            End::Timeout => "timeout".to_owned(),
            End::Other(e) => format!("read error ({e})"),
        }
    }
}

/// What one exchange of the close client observed.
pub struct Exchange {
    /// Body bytes written before the writes stopped.
    pub written: usize,
    /// Body bytes the client meant to write.
    pub body_len: usize,
    /// The error that stopped the writes (head or body), if any.
    pub write_error: Option<String>,
    /// The answer, framed by its headers, or why the bytes read are not a whole answer.
    pub answer: Result<Response, String>,
    /// Bytes read in all, answer included.
    pub read: usize,
    pub end: End,
    pub elapsed: Duration,
}

impl Exchange {
    /// The whole body was written and no write failed.
    pub fn wrote_all(&self) -> bool {
        self.write_error.is_none() && self.written == self.body_len
    }

    /// One line for logs and assertion messages.
    pub fn summary(&self) -> String {
        let writes = match &self.write_error {
            None => format!("wrote {} of {} body bytes", self.written, self.body_len),
            Some(e) => format!(
                "wrote {} of {} body bytes, then the write failed: {e}",
                self.written, self.body_len
            ),
        };
        let answer = match &self.answer {
            Ok(r) => format!(
                "answer {} ({} body bytes, Connection {:?})",
                r.status,
                r.body.len(),
                r.header("connection")
            ),
            Err(e) => format!("no whole answer in {} bytes read: {e}", self.read),
        };
        format!(
            "{writes}; {answer}; stream ended with {} after {} ms",
            self.end.name(),
            self.elapsed.as_millis()
        )
    }
}

enum Conn {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
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

/// Sends `head` and then `body` to `endpoint` on one new connection and reads until the stream ends. `Err` only
/// when the connection or the TLS session cannot be set up; everything after that is in the `Exchange`.
pub fn close_exchange(
    ctx: &Ctx,
    what: &str,
    endpoint: &Endpoint,
    head: &str,
    body: &[u8],
) -> io::Result<Exchange> {
    let started = Instant::now();
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, endpoint.port()));
    let socket = connect(ctx, addr)?;
    // The only two `setsockopt` calls of the exchange, before any byte is written.
    socket.set_read_timeout(Some(IDLE_BOUND))?;
    socket.set_write_timeout(Some(IDLE_BOUND))?;
    let (mut conn, tls) = match endpoint {
        Endpoint::Engine(_) => (Conn::Plain(socket), false),
        Endpoint::Emulator { ca, .. } => {
            let name =
                ServerName::IpAddress(PkiIpAddr::from(std::net::IpAddr::V4(Ipv4Addr::LOCALHOST)));
            let tls = ClientConnection::new(tls_config(ca)?, name)
                .map_err(|e| io::Error::other(format!("TLS: {e}")))?;
            (Conn::Tls(Box::new(StreamOwned::new(tls, socket))), true)
        }
    };

    let mut written = 0;
    let mut write_error = None;
    if let Err(e) = conn.write_all(head.as_bytes()).and_then(|_| conn.flush()) {
        write_error = Some(format!("head: {e}"));
    }
    if write_error.is_none() {
        for chunk in body.chunks(CHUNK) {
            if started.elapsed() >= EXCHANGE_BOUND {
                write_error = Some("the exchange bound passed while writing".to_owned());
                break;
            }
            match write_counted(&mut conn, chunk, &mut written) {
                Ok(()) => {}
                Err(e) => {
                    write_error = Some(e.to_string());
                    break;
                }
            }
        }
    }

    let mut raw = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    let end = loop {
        if started.elapsed() >= EXCHANGE_BOUND {
            break End::Timeout;
        }
        match conn.read(&mut buf) {
            Ok(0) => break End::Eof,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => {
                break match e.kind() {
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => End::Timeout,
                    io::ErrorKind::ConnectionReset
                    | io::ErrorKind::ConnectionAborted
                    | io::ErrorKind::BrokenPipe => End::Reset,
                    io::ErrorKind::UnexpectedEof if tls => End::Eof,
                    _ => End::Other(e.to_string()),
                };
            }
        }
    };

    let exchange = Exchange {
        written,
        body_len: body.len(),
        write_error,
        answer: parse(&raw, head.starts_with("HEAD "), started.elapsed()),
        read: raw.len(),
        end,
        elapsed: started.elapsed(),
    };
    ctx.log(format!(
        "{what}, close client to the {}: {}",
        match endpoint {
            Endpoint::Engine(_) => "engine",
            Endpoint::Emulator { .. } => "emulator",
        },
        exchange.summary()
    ));
    Ok(exchange)
}

/// Writes all of `chunk`, adding each accepted byte to `written`, then flushes.
fn write_counted(conn: &mut Conn, mut chunk: &[u8], written: &mut usize) -> io::Result<()> {
    while !chunk.is_empty() {
        match conn.write(chunk) {
            Ok(0) => return Err(io::Error::new(io::ErrorKind::WriteZero, "wrote 0 bytes")),
            Ok(n) => {
                *written += n;
                chunk = &chunk[n..];
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    conn.flush()
}

/// The answer in `raw`, after any interim `1xx` answers, framed by `Content-Length`, chunked encoding or the end
/// of the stream.
fn parse(mut raw: &[u8], head_request: bool, elapsed: Duration) -> Result<Response, String> {
    loop {
        let end = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or("no end of the answer's headers")?;
        let head = std::str::from_utf8(&raw[..end]).map_err(|_| "headers are not UTF-8")?;
        let mut lines = head.split("\r\n");
        let status_line = lines.next().unwrap_or_default();
        let status = status_line
            .split(' ')
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .filter(|_| status_line.starts_with("HTTP/1."))
            .ok_or("malformed status line")?;
        let rest = &raw[end + 4..];
        if (100..200).contains(&status) {
            raw = rest;
            continue;
        }
        let headers: Vec<(String, String)> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_owned()))
            .collect();
        let find = |name: &str| headers.iter().find(|(n, _)| n == name).map(|(_, v)| v);
        let body = if head_request || status == 204 || status == 304 {
            Vec::new()
        } else if find("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
            dechunk(rest).ok_or("incomplete or malformed chunked body")?
        } else if let Some(length) = find("content-length") {
            let length: usize = length.parse().map_err(|_| "malformed content-length")?;
            rest.get(..length)
                .ok_or_else(|| format!("{} of {length} body bytes", rest.len()))?
                .to_vec()
        } else {
            rest.to_vec()
        };
        return Ok(Response {
            status,
            headers,
            body,
            elapsed,
        });
    }
}

fn dechunk(mut rest: &[u8]) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let line_end = rest.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&rest[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            return Some(body);
        }
        body.extend_from_slice(rest.get(..size)?);
        rest = rest.get(size + 2..)?;
    }
}

/// A client configuration that trusts only the certificates in `ca` (ring provider, no platform roots), as
/// `support/aws.rs` builds it.
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

/// The head of an S3 request straight to the emulator on `port`, header-signed now with its key: `headers` and
/// `Host` signed, `X-Amz-Content-SHA256` set to `payload`, then `Content-Length` and `Connection: close`, in the
/// order `Call::send` writes them.
pub fn direct_head(
    ctx: &Ctx,
    port: u16,
    method: &str,
    target: &str,
    headers: &[(&str, &str)],
    payload: &str,
    content_length: usize,
) -> Result<String, Env> {
    let files = EmulatorFiles::read(&emulator_dir(&ctx.home, port)).ok_or_else(|| {
        Env::new(format!(
            "the files of the emulator on port {port} are missing or incomplete"
        ))
    })?;
    let invalid = |e: &dyn std::fmt::Display| Env::new(format!("cannot sign the direct head: {e}"));
    let identity = Credentials::new(
        files.access_key_id.clone(),
        files.secret_access_key.clone(),
        None,
        None,
        "emuforge-integration",
    )
    .into();
    let mut settings = SigningSettings::default();
    settings.signature_location = SignatureLocation::Headers;
    settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
    settings.percent_encoding_mode = PercentEncodingMode::Single;
    settings.uri_path_normalization_mode = UriPathNormalizationMode::Disabled;
    let params = v4::SigningParams::builder()
        .identity(&identity)
        .region(REGION)
        .name("s3")
        .time(SystemTime::now())
        .settings(settings)
        .build()
        .map_err(|e| invalid(&e))?
        .into();
    let host = format!("127.0.0.1:{port}");
    let mut signed: Vec<(&str, &str)> = vec![("host", host.as_str())];
    signed.extend(headers.iter().copied());
    let request = SignableRequest::new(
        method,
        Cow::Owned(format!("http://{host}{target}")),
        signed.into_iter(),
        SignableBody::Precomputed(payload.to_owned()),
    )
    .map_err(|e| invalid(&e))?;
    let (instructions, _) = sign(request, &params)
        .map_err(|e| invalid(&e))?
        .into_parts();
    let (signature_headers, _) = instructions.into_parts();
    let mut head = format!("{method} {target} HTTP/1.1\r\nHost: {host}\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    for h in signature_headers.iter() {
        head.push_str(&format!("{}: {}\r\n", h.name(), h.value()));
    }
    head.push_str(&format!(
        "Content-Length: {content_length}\r\nConnection: close\r\n\r\n"
    ));
    Ok(head)
}
