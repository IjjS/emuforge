#![cfg(test)]

use std::fs;
use std::num::NonZeroU16;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use emuforge_core::{
    CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles, Health, PROBE_DEADLINE, Reason, probe,
    probe_on,
};
use rcgen::{CertificateParams, KeyPair};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tempfile::TempDir;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream};
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;

const PORT: u16 = 9391;
const CREDENTIALS: &str =
    "[default]\naws_access_key_id = probe-test-key-id\naws_secret_access_key = probe-test-secret\n";
const OK: &[u8] =
    b"HTTP/1.1 200 OK\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: 2\r\n\r\nok";

struct Certificate {
    der: CertificateDer<'static>,
    pem: String,
    key: KeyPair,
}

fn certificate(names: &[&str], key: KeyPair) -> Certificate {
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

/// Certificate A: SAN `IP:127.0.0.1`, the one written to `ca.pem`.
fn certificate_a() -> Certificate {
    certificate(&["127.0.0.1"], KeyPair::generate().unwrap())
}

fn emulator(home: &Path) -> Emulator {
    Emulator::new(home, NonZeroU16::new(PORT).unwrap())
}

fn write_files(home: &Path, ca: &str, credentials: &str) {
    let dir = emulator(home).dir().to_owned();
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(CA_FILE), ca).unwrap();
    fs::write(dir.join(CREDENTIALS_FILE), credentials).unwrap();
}

/// A temp home whose `ca.pem` holds `ca`, and the files read from it.
async fn files_trusting(ca: &Certificate) -> (TempDir, Emulator, EmulatorFiles) {
    let home = tempfile::tempdir().unwrap();
    write_files(home.path(), &ca.pem, CREDENTIALS);
    let emulator = emulator(home.path());
    let files = EmulatorFiles::read(&emulator).await.unwrap();
    (home, emulator, files)
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

/// Reads request heads until the client goes away, answering the first with `answer`. Returns every head.
async fn serve_heads<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    answer: &[u8],
) -> Vec<String> {
    let mut heads = Vec::new();
    let mut pending = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return heads,
            Ok(read) => read,
        };
        pending.extend_from_slice(&buffer[..read]);
        while let Some(end) = pending.windows(4).position(|window| window == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&pending[..end]).into_owned();
            pending.drain(..end + 4);
            heads.push(head);
            if heads.len() == 1 && stream.write_all(answer).await.is_err() {
                return heads;
            }
        }
    }
}

/// A duplex peer that presents `presented` and answers the first request with `answer`.
fn tls_peer(
    presented: &Certificate,
    answer: &'static [u8],
) -> (DuplexStream, JoinHandle<Vec<String>>) {
    let (client, server) = tokio::io::duplex(64 * 1024);
    let acceptor = acceptor(presented);
    let peer = tokio::spawn(async move {
        match acceptor.accept(server).await {
            Ok(tls) => serve_heads(tls, answer).await,
            Err(_) => Vec::new(),
        }
    });
    (client, peer)
}

/// A duplex peer that reads everything and never writes.
fn silent_peer() -> DuplexStream {
    let (client, mut server) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let mut buffer = [0u8; 4096];
        while matches!(server.read(&mut buffer).await, Ok(read) if read > 0) {}
    });
    client
}

#[tokio::test(start_paused = true)]
async fn probe_on_trusted_peer_answering_ok_is_reachable() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let (stream, _peer) = tls_peer(&a, OK);
    assert_eq!(
        probe_on(stream, &emulator, &files, PROBE_DEADLINE).await,
        Health::Reachable
    );
}

#[tokio::test(start_paused = true)]
async fn probe_on_sends_one_unsigned_get_admin_health_with_loopback_host() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let (stream, peer) = tls_peer(&a, OK);
    probe_on(stream, &emulator, &files, PROBE_DEADLINE).await;
    let heads = peer.await.unwrap();
    assert_eq!(heads.len(), 1, "{heads:?}");
    let mut lines = heads[0].split("\r\n");
    assert_eq!(lines.next(), Some("GET /__admin/health HTTP/1.1"));
    let headers = lines.map(str::to_ascii_lowercase).collect::<Vec<_>>();
    assert!(
        headers.contains(&format!("host: 127.0.0.1:{PORT}")),
        "{headers:?}"
    );
    assert!(
        !headers
            .iter()
            .any(|header| header.starts_with("authorization:")),
        "{headers:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn probe_on_peer_with_another_certificate_is_tls_untrusted() {
    let a = certificate_a();
    let cases = [
        (
            "another key, same SAN",
            certificate(&["127.0.0.1"], KeyPair::generate().unwrap()),
        ),
        (
            "same key, SAN DNS:example.com only",
            certificate(
                &["example.com"],
                KeyPair::from_pem(&a.key.serialize_pem()).unwrap(),
            ),
        ),
    ];
    let (_home, emulator, files) = files_trusting(&a).await;
    for (name, presented) in cases {
        let (stream, _peer) = tls_peer(&presented, OK);
        assert_eq!(
            probe_on(stream, &emulator, &files, PROBE_DEADLINE).await,
            Health::Unreachable(Reason::TlsUntrusted),
            "case {name}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn probe_on_answer_other_than_200_ok_is_unexpected_response() {
    const SERVER_ERROR: &[u8] = b"HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n";
    const REDIRECT: &[u8] = b"HTTP/1.1 302 Found\r\nlocation: https://127.0.0.1:9391/__admin/health\r\ncontent-length: 0\r\n\r\n";
    const OTHER_BODY: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nno";
    const LONG_BODY: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-length: 65\r\n\r\nokokokokokokokokokokokokokokokokokokokokokokokokokokokokokokokoko";
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let cases = [
        ("500", SERVER_ERROR, 500),
        ("302 with Location", REDIRECT, 302),
        ("200 body no", OTHER_BODY, 200),
        ("200 with a 65-byte body", LONG_BODY, 200),
    ];
    for (name, answer, status) in cases {
        let (stream, peer) = tls_peer(&a, answer);
        assert_eq!(
            probe_on(stream, &emulator, &files, PROBE_DEADLINE).await,
            Health::Unreachable(Reason::UnexpectedResponse { status }),
            "case {name}"
        );
        let heads = peer.await.unwrap();
        assert_eq!(heads.len(), 1, "case {name}: {heads:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn probe_on_plain_http_instead_of_tls_is_connection_failed() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let (client, mut server) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let mut buffer = [0u8; 4096];
        if server.read(&mut buffer).await.is_ok() {
            let _ = server
                .write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n")
                .await;
        }
        while matches!(server.read(&mut buffer).await, Ok(read) if read > 0) {}
    });
    let health = probe_on(client, &emulator, &files, PROBE_DEADLINE).await;
    assert!(
        matches!(health, Health::Unreachable(Reason::ConnectionFailed { .. })),
        "{health:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn probe_on_peer_closing_after_handshake_is_connection_failed() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let (client, server) = tokio::io::duplex(64 * 1024);
    let acceptor = acceptor(&a);
    tokio::spawn(async move {
        if let Ok(mut tls) = acceptor.accept(server).await {
            let _ = tls.shutdown().await;
        }
    });
    let health = probe_on(client, &emulator, &files, PROBE_DEADLINE).await;
    assert!(
        matches!(health, Health::Unreachable(Reason::ConnectionFailed { .. })),
        "{health:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn probe_on_silent_peer_times_out_at_the_deadline() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    let start = tokio::time::Instant::now();
    let probing = probe_on(silent_peer(), &emulator, &files, PROBE_DEADLINE);
    tokio::pin!(probing);
    let early = tokio::time::timeout(PROBE_DEADLINE - Duration::from_millis(1), &mut probing).await;
    assert!(early.is_err(), "answered before the deadline: {early:?}");
    assert_eq!(probing.await, Health::Unreachable(Reason::Timeout));
    assert_eq!(start.elapsed(), PROBE_DEADLINE);
}

#[tokio::test(start_paused = true)]
async fn probe_on_after_a_timeout_is_reachable_again() {
    let a = certificate_a();
    let (_home, emulator, files) = files_trusting(&a).await;
    assert_eq!(
        probe_on(silent_peer(), &emulator, &files, PROBE_DEADLINE).await,
        Health::Unreachable(Reason::Timeout)
    );
    let (stream, _peer) = tls_peer(&a, OK);
    assert_eq!(
        probe_on(stream, &emulator, &files, PROBE_DEADLINE).await,
        Health::Reachable
    );
}

#[tokio::test(start_paused = true)]
async fn probe_without_emulator_directory_is_not_started() {
    let home = tempfile::tempdir().unwrap();
    assert_eq!(
        probe(&emulator(home.path()), PROBE_DEADLINE).await,
        Health::Unreachable(Reason::NotStarted)
    );
}

#[tokio::test(start_paused = true)]
async fn probe_with_malformed_files_is_files_unreadable_naming_the_file() {
    let a = certificate_a();
    // A CERTIFICATE block whose base64 decodes to bytes that are not a certificate.
    let not_a_certificate =
        "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n";
    let cases = [
        (
            "ca.pem malformed",
            "no certificate here\n",
            CREDENTIALS,
            CA_FILE,
        ),
        (
            "emulator_credentials malformed",
            a.pem.as_str(),
            "[default]\n",
            CREDENTIALS_FILE,
        ),
        (
            "ca.pem block is not a certificate",
            not_a_certificate,
            CREDENTIALS,
            CA_FILE,
        ),
    ];
    for (name, ca, credentials, file) in cases {
        let home = tempfile::tempdir().unwrap();
        write_files(home.path(), ca, credentials);
        assert_eq!(
            probe(&emulator(home.path()), PROBE_DEADLINE).await,
            Health::Unreachable(Reason::FilesUnreadable { file }),
            "case {name}"
        );
    }
}

fn every_reason() -> [(&'static str, Reason); 7] {
    [
        ("not_started", Reason::NotStarted),
        (
            "files_unreadable",
            Reason::FilesUnreadable { file: CA_FILE },
        ),
        ("connection_refused", Reason::ConnectionRefused),
        ("tls_untrusted", Reason::TlsUntrusted),
        ("timeout", Reason::Timeout),
        (
            "unexpected_response",
            Reason::UnexpectedResponse { status: 418 },
        ),
        (
            "connection_failed",
            Reason::ConnectionFailed {
                kind: "connection reset".to_owned(),
            },
        ),
    ]
}

#[test]
fn reason_code_names_each_variant() {
    for (code, reason) in every_reason() {
        assert_eq!(reason.code(), code, "case {code}");
    }
}

#[test]
fn reason_message_names_what_failed() {
    let emulator = emulator(Path::new("/h"));
    let endpoint = "https://127.0.0.1:9391";
    let expected: [(&str, &[&str]); 7] = [
        ("not_started", &["port 9391"]),
        ("files_unreadable", &[CA_FILE]),
        ("connection_refused", &[endpoint]),
        ("tls_untrusted", &[CA_FILE]),
        ("timeout", &["2 s"]),
        ("unexpected_response", &["418"]),
        ("connection_failed", &["connection reset"]),
    ];
    for ((code, reason), (expected_code, parts)) in every_reason().into_iter().zip(expected) {
        assert_eq!(code, expected_code);
        let message = reason.message(&emulator);
        for part in parts {
            assert!(message.contains(part), "case {code}: {message}");
        }
    }
    let failed = Reason::ConnectionFailed {
        kind: "connection reset".to_owned(),
    }
    .message(&emulator);
    assert_eq!(
        failed,
        format!("the connection to {endpoint} failed (connection reset)")
    );
}
