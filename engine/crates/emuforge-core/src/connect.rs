//! One connection to the emulator: TCP to its loopback `<ip>:<port>` and a TLS handshake that trusts only its `ca.pem`,
//! together inside one deadline.

use std::io;
use std::net::IpAddr;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use rustls::ClientConfig;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;

use crate::{CA_FILE, Emulator, EmulatorFiles, Error, IdleWrite, Reason, client_config};

/// Connect plus TLS handshake, for every connection to the emulator. Equal to the health probe's deadline.
pub const CONNECT_DEADLINE: Duration = Duration::from_secs(2);

/// The stream a relayed exchange runs over: TLS over TCP whose writes are bounded by an idle limit.
pub type EmulatorStream = TlsStream<IdleWrite<TcpStream>>;

/// An open, verified connection to the emulator.
pub struct Upstream {
    pub stream: EmulatorStream,
    /// Set when a write to the emulator stayed pending for the write idle bound (the [`IdleWrite`] flag).
    pub stalled: Arc<AtomicBool>,
}

/// Opens TCP to [`Emulator::socket_addr`] (an IP address, never a name) and completes TLS against `files`'
/// `ca.pem`, both within `deadline`. Writes on the stream fail after `write_idle` without progress.
pub async fn connect(
    emulator: &Emulator,
    files: &EmulatorFiles,
    deadline: Duration,
    write_idle: Duration,
) -> Result<Upstream, Reason> {
    let config = client_config(files).map_err(from_files)?;
    let attempt = async {
        let tcp = TcpStream::connect(emulator.socket_addr())
            .await
            .map_err(|error| match error.kind() {
                io::ErrorKind::ConnectionRefused => Reason::ConnectionRefused,
                kind => Reason::ConnectionFailed {
                    kind: kind.to_string(),
                },
            })?;
        let idle = IdleWrite::new(tcp, write_idle);
        let stalled = idle.stalled_flag();
        let stream = handshake(idle, emulator.ip(), config).await?;
        Ok(Upstream { stream, stalled })
    };
    tokio::time::timeout(deadline, attempt)
        .await
        .unwrap_or(Err(Reason::Timeout))
}

/// The TLS part of [`connect`] over an already open byte stream, for `emulator`'s IP as the server name,
/// within `deadline`.
pub async fn connect_on<S>(
    stream: S,
    emulator: &Emulator,
    files: &EmulatorFiles,
    deadline: Duration,
) -> Result<TlsStream<S>, Reason>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let config = client_config(files).map_err(from_files)?;
    tokio::time::timeout(deadline, handshake(stream, emulator.ip(), config))
        .await
        .unwrap_or(Err(Reason::Timeout))
}

/// The handshake for the server name `ip` (the emulator's loopback IP), with no deadline of its own.
pub(crate) async fn handshake<S>(
    stream: S,
    ip: IpAddr,
    config: Arc<ClientConfig>,
) -> Result<TlsStream<S>, Reason>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let server_name = ServerName::IpAddress(ip.into());
    TlsConnector::from(config)
        .connect(server_name, stream)
        .await
        .map_err(from_handshake)
}

/// The reason for a failure to read the emulator's files or to build trust from them.
pub(crate) fn from_files(error: Error) -> Reason {
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
