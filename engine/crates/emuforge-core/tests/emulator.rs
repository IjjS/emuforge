#![cfg(test)]

use std::fs;
use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::Path;
use std::sync::Arc;

use bytes::Bytes;
use emuforge_core::{
    CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles, Endpoint, Health, Limits, PROBE_DEADLINE,
    Reason, probe, probe_on, relay,
};
use http::Request;
use http_body_util::Empty;
use rcgen::{CertificateParams, KeyPair};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tempfile::TempDir;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;

const CREDENTIALS: &str = "[default]\naws_access_key_id = emulator-test-key-id\naws_secret_access_key = emulator-test-secret\n";
const OK: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok";

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

#[test]
fn emulator_new_places_dir_under_home_aws_emulator_port() {
    let home = Path::new("/home/someone");
    let emulator = Emulator::new(home, port(9297));
    assert_eq!(
        emulator.dir(),
        Path::new("/home/someone/.aws/emulator/9297")
    );
}

#[test]
fn emulator_endpoint_is_https_loopback_with_port() {
    for (name, value) in [("lowest", 1), ("default", 9297), ("highest", 65535)] {
        let emulator = Emulator::new(Path::new("/h"), port(value));
        assert_eq!(
            emulator.endpoint(),
            format!("https://127.0.0.1:{value}"),
            "case {name}"
        );
    }
}

#[test]
fn emulator_socket_addr_is_loopback_with_port() {
    for (name, value) in [("lowest", 1), ("default", 9297), ("highest", 65535)] {
        let emulator = Emulator::new(Path::new("/h"), port(value));
        assert_eq!(
            emulator.socket_addr(),
            SocketAddr::new(Ipv4Addr::LOCALHOST.into(), value),
            "case {name}"
        );
    }
}

#[test]
fn emulator_for_endpoint_ipv6_is_bracketed_and_files_by_port() {
    let endpoint = Endpoint::parse("https://[::1]:9310").unwrap();
    let emulator = Emulator::for_endpoint(Path::new("/home/someone"), &endpoint);
    assert_eq!(emulator.endpoint(), "https://[::1]:9310");
    assert_eq!(emulator.socket_addr().to_string(), "[::1]:9310");
    assert_eq!(
        emulator.dir(),
        Path::new("/home/someone/.aws/emulator/9310")
    );
}

struct Certificate {
    der: CertificateDer<'static>,
    pem: String,
    key: KeyPair,
}

/// A self-signed certificate for `names` (IP addresses become IP names), as the emulator's own is.
fn certificate(names: &[&str]) -> Certificate {
    let key = KeyPair::generate().unwrap();
    let names = names
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let cert = CertificateParams::new(names)
        .unwrap()
        .self_signed(&key)
        .unwrap();
    Certificate {
        der: cert.der().clone(),
        pem: cert.pem(),
        key,
    }
}

fn acceptor(presented: &Certificate) -> TlsAcceptor {
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(presented.key.serialize_der()));
    let config =
        ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![presented.der.clone()], key)
            .unwrap();
    TlsAcceptor::from(Arc::new(config))
}

/// The emulator for `endpoint` with a temp home whose files trust `ca`.
fn emulator_trusting(endpoint: &str, ca: &Certificate) -> (TempDir, Emulator) {
    let home = tempfile::tempdir().unwrap();
    let emulator = Emulator::for_endpoint(home.path(), &Endpoint::parse(endpoint).unwrap());
    fs::create_dir_all(emulator.dir()).unwrap();
    fs::write(emulator.dir().join(CA_FILE), &ca.pem).unwrap();
    fs::write(emulator.dir().join(CREDENTIALS_FILE), CREDENTIALS).unwrap();
    (home, emulator)
}

/// Reads one request head, answers it with `answer`, and returns the head.
async fn answer_one<S: AsyncRead + AsyncWrite + Unpin>(mut stream: S, answer: &[u8]) -> String {
    let mut pending = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        if let Some(end) = pending.windows(4).position(|window| window == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&pending[..end]).into_owned();
            stream.write_all(answer).await.unwrap();
            stream.flush().await.unwrap();
            return head;
        }
        let read = stream.read(&mut buffer).await.unwrap();
        assert!(read > 0, "the client closed before a whole head");
        pending.extend_from_slice(&buffer[..read]);
    }
}

/// A TLS server on `address` (port 0: any free one) presenting `presented`, answering one request with `answer`.
async fn tls_server(
    address: &str,
    presented: &Certificate,
    answer: &'static [u8],
) -> (u16, JoinHandle<String>) {
    let listener = TcpListener::bind(address).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let acceptor = acceptor(presented);
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let tls = acceptor.accept(tcp).await.unwrap();
        answer_one(tls, answer).await
    });
    (port, server)
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

#[tokio::test]
async fn probe_ipv4_loopback_is_reachable_with_its_host() {
    let presented = certificate(&["127.0.0.1", "::1"]);
    let (port, server) = tls_server("127.0.0.1:0", &presented, OK).await;
    let (_home, emulator) = emulator_trusting(&format!("https://127.0.0.1:{port}"), &presented);
    assert_eq!(probe(&emulator, PROBE_DEADLINE).await, Health::Reachable);
    let head = server.await.unwrap();
    assert_eq!(
        header(&head, "host"),
        Some(format!("127.0.0.1:{port}").as_str())
    );
}

#[tokio::test]
async fn probe_ipv6_loopback_listening_there_is_reachable() {
    let presented = certificate(&["127.0.0.1", "::1"]);
    let (port, server) = tls_server("[::1]:0", &presented, OK).await;
    let (_home, emulator) = emulator_trusting(&format!("https://[::1]:{port}"), &presented);
    assert_eq!(probe(&emulator, PROBE_DEADLINE).await, Health::Reachable);
    let head = server.await.unwrap();
    assert_eq!(
        header(&head, "host"),
        Some(format!("[::1]:{port}").as_str())
    );
}

#[tokio::test]
async fn probe_certificate_without_the_emulator_ip_is_tls_untrusted() {
    // 127.0.0.2 is not an address of every host's loopback, so the server is a byte stream, not a socket: the
    // address only names the TLS server, which is what is checked.
    let presented = certificate(&["127.0.0.1"]);
    let (_home, emulator) = emulator_trusting("https://127.0.0.2:9311", &presented);
    let files = EmulatorFiles::read(&emulator).await.unwrap();
    let (client, server) = tokio::io::duplex(64 * 1024);
    let acceptor = acceptor(&presented);
    tokio::spawn(async move { acceptor.accept(server).await.is_ok() });
    assert_eq!(
        probe_on(client, &emulator, &files, PROBE_DEADLINE).await,
        Health::Unreachable(Reason::TlsUntrusted)
    );
}

#[tokio::test]
async fn relay_to_ipv6_loopback_forwards_its_host() {
    let presented = certificate(&["127.0.0.1", "::1"]);
    let (port, server) = tls_server("[::1]:0", &presented, OK).await;
    let (_home, emulator) = emulator_trusting(&format!("https://[::1]:{port}"), &presented);
    let request = Request::get("/")
        .header("host", "127.0.0.1:9297")
        .body(Empty::<Bytes>::new())
        .unwrap();
    let response = relay(&emulator, request, &Limits::DEFAULT).await.unwrap();
    assert_eq!(response.status(), 200);
    let head = server.await.unwrap();
    assert_eq!(
        header(&head, "host"),
        Some(format!("[::1]:{port}").as_str())
    );
}
