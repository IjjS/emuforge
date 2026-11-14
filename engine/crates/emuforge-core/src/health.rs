//! Whether the emulator answers `GET /__admin/health` with `200 ok` over TLS verified against its `ca.pem`.

use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use http_body_util::{BodyExt, Empty, LengthLimitError, Limited};
use hyper::body::Bytes;
use hyper::header::HOST;
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

use crate::{CA_FILE, Emulator, EmulatorFiles, Error, client_config};

/// The probe's whole budget: connect, TLS handshake and response.
pub const PROBE_DEADLINE: Duration = Duration::from_secs(2);
/// The emulator's admin health route.
pub const HEALTH_PATH: &str = "/__admin/health";
/// The answer body the emulator gives when it is up.
const HEALTHY_BODY: &[u8] = b"ok";
/// The health answer is read no further than this many bytes.
const BODY_CAP: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Health {
    Reachable,
    Unreachable(Reason),
}

/// Why the emulator is not reachable. Nothing in a reason comes from the emulator's files or its answer bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reason {
    /// The emulator's directory or one of its two files does not exist.
    NotStarted,
    /// A file exists but cannot be read or is not in the expected form.
    FilesUnreadable { file: &'static str },
    /// Nothing listens on the emulator port.
    ConnectionRefused,
    /// The server's certificate does not verify against `ca.pem`.
    TlsUntrusted,
    /// No complete answer within [`PROBE_DEADLINE`].
    Timeout,
    /// An answer other than `200` with body `ok`.
    UnexpectedResponse { status: u16 },
    /// Any other connection error, by kind only.
    ConnectionFailed { kind: String },
}

impl Reason {
    pub fn code(&self) -> &'static str {
        match self {
            Reason::NotStarted => "not_started",
            Reason::FilesUnreadable { .. } => "files_unreadable",
            Reason::ConnectionRefused => "connection_refused",
            Reason::TlsUntrusted => "tls_untrusted",
            Reason::Timeout => "timeout",
            Reason::UnexpectedResponse { .. } => "unexpected_response",
            Reason::ConnectionFailed { .. } => "connection_failed",
        }
    }

    /// What failed and what to do, for the emulator this reason was found for.
    pub fn message(&self, emulator: &Emulator) -> String {
        let port = emulator.port();
        let endpoint = emulator.endpoint();
        match self {
            Reason::NotStarted => format!(
                "there are no emulator files for port {port} (~/.aws/emulator/{port}/); start the emulator on port {port}"
            ),
            Reason::FilesUnreadable { file } => format!(
                "the emulator file {file} for port {port} cannot be read or is not in the expected form; restart the emulator on port {port}"
            ),
            Reason::ConnectionRefused => format!(
                "nothing answers on {endpoint}; the emulator for port {port} is not running, start it again"
            ),
            Reason::TlsUntrusted => format!(
                "the certificate presented on {endpoint} is not the one in {CA_FILE}; restart the emulator on port {port}"
            ),
            Reason::Timeout => format!(
                "the emulator on {endpoint} did not answer within {} s",
                PROBE_DEADLINE.as_secs()
            ),
            Reason::UnexpectedResponse { status } => format!(
                "the emulator on {endpoint} answered {HEALTH_PATH} with status {status}, not 200 ok"
            ),
            Reason::ConnectionFailed { kind } => {
                format!("the connection to {endpoint} failed ({kind})")
            }
        }
    }
}

/// Reads the emulator's files, connects to `127.0.0.1:<port>` and asks its health route, all within
/// `deadline`. Every failure becomes a [`Reason`]; nothing is kept for the next call.
pub async fn probe(emulator: &Emulator, deadline: Duration) -> Health {
    let attempt = async {
        let files = EmulatorFiles::read(emulator).await.map_err(from_files)?;
        let stream =
            TcpStream::connect(emulator.socket_addr())
                .await
                .map_err(|error| match error.kind() {
                    io::ErrorKind::ConnectionRefused => Reason::ConnectionRefused,
                    kind => Reason::ConnectionFailed {
                        kind: kind.to_string(),
                    },
                })?;
        exchange(stream, emulator, &files).await
    };
    into_health(tokio::time::timeout(deadline, attempt).await)
}

/// The TLS handshake and the health request over an already open byte stream, within `deadline`.
pub async fn probe_on<S>(
    stream: S,
    emulator: &Emulator,
    files: &EmulatorFiles,
    deadline: Duration,
) -> Health
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    into_health(tokio::time::timeout(deadline, exchange(stream, emulator, files)).await)
}

fn into_health(result: Result<Result<(), Reason>, tokio::time::error::Elapsed>) -> Health {
    match result {
        Ok(Ok(())) => Health::Reachable,
        Ok(Err(reason)) => Health::Unreachable(reason),
        Err(_) => Health::Unreachable(Reason::Timeout),
    }
}

fn from_files(error: Error) -> Reason {
    match error {
        Error::FilesMissing { .. } => Reason::NotStarted,
        Error::FileUnreadable { file, .. } | Error::FileMalformed { file } => {
            Reason::FilesUnreadable { file }
        }
        Error::TrustStore => Reason::FilesUnreadable { file: CA_FILE },
        Error::TlsConfig => tls_failed(),
    }
}

fn tls_failed() -> Reason {
    Reason::ConnectionFailed { kind: "tls".into() }
}

fn http_failed() -> Reason {
    Reason::ConnectionFailed {
        kind: "http".into(),
    }
}

/// One request, never a second: a redirect is an unexpected answer, not a place to go.
async fn exchange<S>(stream: S, emulator: &Emulator, files: &EmulatorFiles) -> Result<(), Reason>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let config = client_config(files).map_err(from_files)?;
    let server_name = ServerName::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST).into());
    let tls = TlsConnector::from(config)
        .connect(server_name, stream)
        .await
        .map_err(from_handshake)?;

    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(tls))
        .await
        .map_err(|_| http_failed())?;
    let request = Request::get(HEALTH_PATH)
        .header(HOST, emulator.socket_addr().to_string())
        .body(Empty::<Bytes>::new())
        .map_err(|_| http_failed())?;
    let answer = async move {
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| http_failed())?;
        let status = response.status();
        if status != StatusCode::OK {
            return Err(Reason::UnexpectedResponse {
                status: status.as_u16(),
            });
        }
        let body = Limited::new(response.into_body(), BODY_CAP)
            .collect()
            .await
            .map_err(|error| {
                if error.downcast_ref::<LengthLimitError>().is_some() {
                    Reason::UnexpectedResponse {
                        status: status.as_u16(),
                    }
                } else {
                    http_failed()
                }
            })?
            .to_bytes();
        if body.as_ref() == HEALTHY_BODY {
            Ok(())
        } else {
            Err(Reason::UnexpectedResponse {
                status: status.as_u16(),
            })
        }
    };

    // The connection is driven here, not spawned, so dropping the probe drops the connection with it.
    tokio::pin!(answer, connection);
    tokio::select! {
        result = &mut answer => result,
        // The connection ended first: whatever answer it delivered is buffered, or the request fails.
        _ = &mut connection => answer.await,
    }
}

fn from_handshake(error: io::Error) -> Reason {
    let rustls_error = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>());
    match rustls_error {
        Some(rustls::Error::InvalidCertificate(_)) => Reason::TlsUntrusted,
        Some(_) => tls_failed(),
        None => Reason::ConnectionFailed {
            kind: error.kind().to_string(),
        },
    }
}
