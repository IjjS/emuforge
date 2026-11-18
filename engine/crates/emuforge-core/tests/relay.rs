#![cfg(test)]

use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::io;
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use bytes::Bytes;
use emuforge_core::chunked::ChunkSigning;
use emuforge_core::sigv4::{Scope, signing_key};
use emuforge_core::{
    CA_FILE, CONNECT_DEADLINE, CREDENTIALS_FILE, Emulator, EmulatorFiles, IdleWrite, Limits,
    Prepared, Reason, RelayBody, RelayError, connect_on, forward, prepare, relay,
};
use http::header::{AUTHORIZATION, CONNECTION, HOST, HeaderMap, HeaderValue};
use http::request::Parts;
use http::{Request, Response, StatusCode};
use http_body::{Body, Frame, SizeHint};
use http_body_util::{BodyExt, Empty, Full};
use rcgen::{CertificateParams, KeyPair};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::client::TlsStream as ClientTls;
use tokio_rustls::server::TlsStream as ServerTls;

const PORT: u16 = 9391;
const ENGINE_HOST: &str = "127.0.0.1:8297";
const EMULATOR_HOST: &str = "127.0.0.1:9391";
/// The stand-in emulator key of the prepare vectors.
const EMULATOR_KEY_ID: &str = "EMUKEYID000000000001";
const CREDENTIALS: &str = "[default]\naws_access_key_id = EMUKEYID000000000001\n\
                           aws_secret_access_key = emuforgeUnitTestSecretKey000000000000001\n";
const CLIENT_KEY_ID: &str = "AKIACLIENTKEY0000001";
const ANY_SIGNATURE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const IDLE: Duration = Duration::from_secs(60);
const MS: Duration = Duration::from_millis(1);
/// The duplex buffer between the engine and the stand-in.
const DUPLEX: usize = 64 * 1024;
const FRAME: usize = 64 * 1024;
const LARGE: usize = 64 * 1024 * 1024;
/// hyper's default HTTP/1 write buffer limit (`DEFAULT_MAX_BUFFER_SIZE` in hyper 1.12.0 `proto/h1/io.rs`).
const HYPER_WRITE_BUFFER: usize = 8192 + 4096 * 100;
/// rustls' default send buffer limit (`DEFAULT_BUFFER_LIMIT` in rustls 0.23.46 `common_state.rs`).
const RUSTLS_SEND_BUFFER: usize = 64 * 1024;
/// Most bytes of an upload handed over but not yet received by the stand-in: hyper's write buffer, the TLS send
/// buffer and the duplex, plus the one frame hyper takes before it checks its limit. Never the body.
const UPLOAD_AHEAD_BOUND: usize = HYPER_WRITE_BUFFER + RUSTLS_SEND_BUFFER + DUPLEX + FRAME;

// ---------------------------------------------------------------------------------------------- vectors

/// Sections of a vector file: `== name ==` lines, each followed by its text verbatim; `#` lines before the first
/// section name the source.
fn sections(file: &str) -> HashMap<String, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/vectors")
        .join(file);
    let text = fs::read_to_string(&path).unwrap();
    let mut sections = HashMap::new();
    let mut current: Option<(String, Vec<&str>)> = None;
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("== ").and_then(|l| l.strip_suffix(" ==")) {
            if let Some((name, lines)) = current.take() {
                sections.insert(name, lines.join("\n"));
            }
            current = Some((name.to_owned(), Vec::new()));
        } else if let Some((_, lines)) = current.as_mut() {
            lines.push(line);
        }
    }
    if let Some((name, lines)) = current {
        sections.insert(name, lines.join("\n"));
    }
    sections
}

/// The captured head of a prepare vector, as received by the recording listener.
fn vector_head(name: &str) -> String {
    sections(&format!("prepare/{name}.txt"))
        .remove("head")
        .unwrap_or_else(|| panic!("prepare/{name}.txt: no head"))
}

/// The presign vector's URL as a request head: its path and query, `Host` the emulator.
fn presign_head() -> String {
    let url = sections("prepare/presign-get-object.txt")
        .remove("url")
        .unwrap();
    let target = url
        .strip_prefix(&format!("http://{EMULATOR_HOST}"))
        .unwrap();
    format!("GET {target} HTTP/1.1\nHost: {EMULATOR_HOST}")
}

/// One head of e2's `cli-heads.txt` (evidence §E-I header sets).
fn cli_head(name: &str) -> String {
    sections("cli-heads.txt").remove(name).unwrap()
}

fn parts(head: &str) -> Parts {
    let mut lines = head.lines();
    let request_line = lines.next().unwrap();
    let mut words = request_line.split(' ');
    let (method, target) = (words.next().unwrap(), words.next().unwrap());
    let mut builder = Request::builder().method(method).uri(target);
    for line in lines {
        let (name, value) = line.split_once(':').unwrap();
        builder = builder.header(name, value.trim_start());
    }
    builder.body(()).unwrap().into_parts().0
}

/// The client form of a captured head: `Host` the engine, the credential's key id `key_id` and any signature,
/// in the `Authorization` header or the presigned query.
fn client_form(captured: &str, key_id: &str) -> String {
    let mut head = captured.replace(
        &format!("Host: {EMULATOR_HOST}"),
        &format!("Host: {ENGINE_HOST}"),
    );
    head = head.replace(
        &format!("Credential={EMULATOR_KEY_ID}"),
        &format!("Credential={key_id}"),
    );
    replace_signature(&head, "Signature=")
        .or_else(|| replace_signature(&head, "X-Amz-Signature="))
        .unwrap_or(head)
}

fn replace_signature(head: &str, marker: &str) -> Option<String> {
    let start = head.find(marker)? + marker.len();
    Some(format!(
        "{}{ANY_SIGNATURE}{}",
        &head[..start],
        &head[start + 64..]
    ))
}

/// The captured head with `Expect` removed: what the emulator must receive.
fn expected_head(captured: &str) -> Parts {
    let mut expected = parts(captured);
    expected.headers.remove("expect");
    expected
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

/// Emulator port 9391 and files holding the stand-in key of the prepare vectors and `ca`.
async fn files_with(ca: &str) -> (TempDir, Emulator, EmulatorFiles) {
    let home = tempfile::tempdir().unwrap();
    write_files(home.path(), ca, CREDENTIALS);
    let emulator = emulator(home.path());
    let files = EmulatorFiles::read(&emulator).await.unwrap();
    (home, emulator, files)
}

async fn prepared(head: &str) -> Result<Prepared, RelayError> {
    let a = certificate_a();
    let (_home, emulator, files) = files_with(&a.pem).await;
    prepare(parts(head), &emulator, files.credentials())
}

fn authorization(prepared: &Prepared) -> &str {
    prepared
        .head
        .headers
        .get(AUTHORIZATION)
        .unwrap()
        .to_str()
        .unwrap()
}

fn signature_of(authorization: &str) -> &str {
    authorization.rsplit_once("Signature=").unwrap().1
}

// ---------------------------------------------------------------------------------------------- prepare

#[tokio::test]
async fn prepare_header_signed_vectors_resign_to_the_captured_authorization() {
    for name in [
        "list-buckets",
        "put-object-k1",
        "put-object-a-b-u-c",
        "get-object",
        "list-objects-v2",
    ] {
        let captured = vector_head(name);
        let prepared = prepared(&client_form(&captured, CLIENT_KEY_ID))
            .await
            .unwrap();
        let expected = expected_head(&captured);
        assert_eq!(
            prepared.head.headers.get(HOST).unwrap(),
            EMULATOR_HOST,
            "{name}"
        );
        assert_eq!(
            prepared.head.headers.get(AUTHORIZATION),
            expected.headers.get(AUTHORIZATION),
            "{name}: authorization"
        );
        assert_eq!(prepared.head.uri, expected.uri, "{name}: path and query");
        assert_eq!(prepared.head.method, expected.method, "{name}: method");
        assert_eq!(prepared.head.headers, expected.headers, "{name}: headers");
        assert!(!prepared.head.headers.contains_key("expect"), "{name}");
    }
}

#[tokio::test]
async fn prepare_with_the_emulator_key_id_itself_resigns() {
    let captured = vector_head("list-buckets");
    let prepared = prepared(&client_form(&captured, EMULATOR_KEY_ID))
        .await
        .unwrap();
    assert_eq!(
        prepared.head.headers.get(AUTHORIZATION),
        expected_head(&captured).headers.get(AUTHORIZATION)
    );
}

#[tokio::test]
async fn prepare_removes_hop_by_hop_headers_and_the_session_token() {
    let captured = vector_head("put-object-k1");
    let client = client_form(&captured, CLIENT_KEY_ID).replace(
        "SignedHeaders=host;",
        "SignedHeaders=host;x-amz-security-token;",
    ) + "\nConnection: keep-alive, x-foo\nX-Foo: bar\nKeep-Alive: timeout=5\nProxy-Connection: keep-alive\n\
         Proxy-Authorization: Basic dXNlcjpwYXNz\nTE: trailers\nTrailer: x-amz-checksum-crc64nvme\n\
         Transfer-Encoding: chunked\nUpgrade: h2c\nX-Amz-Security-Token: client-session-token";
    let prepared = prepared(&client).await.unwrap();
    for name in [
        "connection",
        "x-foo",
        "keep-alive",
        "proxy-connection",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "x-amz-security-token",
    ] {
        assert!(!prepared.head.headers.contains_key(name), "{name} removed");
    }
    assert_eq!(
        prepared.head.headers.get(AUTHORIZATION),
        expected_head(&captured).headers.get(AUTHORIZATION)
    );
}

#[tokio::test]
async fn prepare_signed_header_not_present_is_left_out_of_the_signature() {
    let captured = vector_head("get-object");
    let client = client_form(&captured, CLIENT_KEY_ID).replace(
        "x-amz-date, Signature",
        "x-amz-date;x-amz-meta-absent, Signature",
    );
    assert!(client.contains("x-amz-meta-absent"));
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(
        prepared.head.headers.get(AUTHORIZATION),
        expected_head(&captured).headers.get(AUTHORIZATION)
    );
}

#[tokio::test]
async fn prepare_payload_hash_is_forwarded_and_signed_as_received() {
    let captured = vector_head("list-buckets");
    let empty_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let vector_signature = signature_of(
        expected_head(&captured)
            .headers
            .get(AUTHORIZATION)
            .unwrap()
            .to_str()
            .unwrap(),
    )
    .to_owned();
    let cases = [
        ("UNSIGNED-PAYLOAD", "UNSIGNED-PAYLOAD".to_owned()),
        (
            "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
            "STREAMING-UNSIGNED-PAYLOAD-TRAILER".to_owned(),
        ),
        ("upper-case hash", empty_hash.to_uppercase()),
        ("empty value", String::new()),
    ];
    let mut signatures = vec![vector_signature];
    for (name, value) in cases {
        let client = client_form(&captured, CLIENT_KEY_ID).replace(
            &format!("X-Amz-Content-SHA256: {empty_hash}"),
            &format!("X-Amz-Content-SHA256: {value}"),
        );
        let prepared = prepared(&client).await.unwrap();
        assert_eq!(
            prepared.head.headers.get("x-amz-content-sha256").unwrap(),
            value.as_str(),
            "{name}: forwarded as received"
        );
        let signature = signature_of(authorization(&prepared)).to_owned();
        assert!(
            !signatures.contains(&signature),
            "{name}: the value is what is signed"
        );
        signatures.push(signature);
    }
}

#[tokio::test]
async fn prepare_without_payload_hash_adds_and_signs_unsigned_payload() {
    let prepared = prepared(&cli_head("dynamodb list-tables")).await.unwrap();
    assert_eq!(
        prepared.head.headers.get("x-amz-content-sha256").unwrap(),
        "UNSIGNED-PAYLOAD"
    );
    let authorization = authorization(&prepared);
    assert!(
        authorization.starts_with(&format!(
            "AWS4-HMAC-SHA256 Credential={EMULATOR_KEY_ID}/20261114/us-east-1/dynamodb/aws4_request, \
             SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, Signature="
        )),
        "{authorization}"
    );
}

#[tokio::test]
async fn prepare_signed_chunk_mode_in_another_case_is_forwarded() {
    let client = client_form(&vector_head("put-object-k1"), CLIENT_KEY_ID).replace(
        "X-Amz-Content-SHA256: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        "X-Amz-Content-SHA256: STREAMING-AWS4-HMAC-SHA256-payload",
    );
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(
        prepared.head.headers.get("x-amz-content-sha256").unwrap(),
        "STREAMING-AWS4-HMAC-SHA256-payload"
    );
}

#[tokio::test]
async fn prepare_lambda_path_is_forwarded_byte_for_byte() {
    let path = "/2015-03-31/functions/arn%3Aaws%3Alambda/configuration";
    let client = cli_head("lambda list-functions").replacen("/2015-03-31/functions", path, 1);
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(prepared.head.uri.path(), path);
    assert_eq!(prepared.head.uri.query(), None);
}

#[tokio::test]
async fn prepare_keeps_the_client_date_and_scope_date() {
    let client = client_form(&vector_head("list-buckets"), CLIENT_KEY_ID)
        .replace(
            "X-Amz-Date: 20261114T162914Z",
            "X-Amz-Date: 20260101T000000Z",
        )
        .replace("/20261114/", "/20260101/");
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(
        prepared.head.headers.get("x-amz-date").unwrap(),
        "20260101T000000Z"
    );
    assert!(authorization(&prepared).starts_with(&format!(
        "AWS4-HMAC-SHA256 Credential={EMULATOR_KEY_ID}/20260101/"
    )));
}

#[tokio::test]
async fn prepare_query_signed_vector_resigns_to_the_captured_query() {
    let captured = presign_head();
    let client = client_form(&captured, CLIENT_KEY_ID);
    assert!(client.contains(&format!("X-Amz-Credential={CLIENT_KEY_ID}%2F")));
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(prepared.head.uri, parts(&captured).uri);
    assert!(!prepared.head.headers.contains_key(AUTHORIZATION));
    assert_eq!(prepared.head.headers.get(HOST).unwrap(), EMULATOR_HOST);
}

#[tokio::test]
async fn prepare_query_signed_drops_the_session_token() {
    let captured = presign_head();
    let client = client_form(&captured, CLIENT_KEY_ID).replace(
        "X-Amz-SignedHeaders=host&",
        "X-Amz-Security-Token=abc&X-Amz-SignedHeaders=host%3Bx-amz-security-token&",
    );
    assert!(client.contains("X-Amz-Security-Token=abc"));
    let prepared = prepared(&client).await.unwrap();
    assert_eq!(prepared.head.uri, parts(&captured).uri);
}

/// Every `Auth::Other` form of e2's `classify` cases, as received by the engine.
fn other_forms() -> Vec<(String, String)> {
    let credential = format!("Credential={CLIENT_KEY_ID}/20261114/us-east-1/s3/aws4_request");
    let signed = "SignedHeaders=host;x-amz-date";
    let signature = format!("Signature={ANY_SIGNATURE}");
    let amz_date = "X-Amz-Date: 20261114T162914Z\n";
    let header_signed = |parts: &[&str], dates: &str| {
        format!(
            "GET /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}\n{dates}Authorization: AWS4-HMAC-SHA256 {}",
            parts.join(", ")
        )
    };
    let mut forms = vec![
        (
            "no signature".to_owned(),
            format!("GET /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}"),
        ),
        (
            "bearer".to_owned(),
            format!("GET /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}\nAuthorization: Bearer abc"),
        ),
        (
            "sigv2".to_owned(),
            format!(
                "GET /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}\nDate: Sat, 14 Nov 2026 16:29:14 GMT\n\
                 Authorization: AWS {CLIENT_KEY_ID}:frJIUN8DYpKDtOLCwo//yllqDzg="
            ),
        ),
        (
            "no Credential".to_owned(),
            header_signed(&[signed, &signature], amz_date),
        ),
        (
            "no SignedHeaders".to_owned(),
            header_signed(&[&credential, &signature], amz_date),
        ),
        (
            "no Signature".to_owned(),
            header_signed(&[&credential, signed], amz_date),
        ),
        (
            "4-part credential".to_owned(),
            header_signed(
                &[
                    &format!("Credential={CLIENT_KEY_ID}/20261114/us-east-1/aws4_request"),
                    signed,
                    &signature,
                ],
                amz_date,
            ),
        ),
        (
            "63 hex signature".to_owned(),
            header_signed(
                &[
                    &credential,
                    signed,
                    &format!("Signature={}", &ANY_SIGNATURE[1..]),
                ],
                amz_date,
            ),
        ),
        (
            "non-hex signature".to_owned(),
            header_signed(
                &[
                    &credential,
                    signed,
                    &format!("Signature=g{}", &ANY_SIGNATURE[1..]),
                ],
                amz_date,
            ),
        ),
        (
            "SignedHeaders without host".to_owned(),
            header_signed(
                &[&credential, "SignedHeaders=x-amz-date", &signature],
                amz_date,
            ),
        ),
        (
            "no X-Amz-Date".to_owned(),
            header_signed(&[&credential, signed, &signature], ""),
        ),
        (
            "X-Amz-Date not yyyymmddThhmmssZ".to_owned(),
            header_signed(
                &[&credential, signed, &signature],
                "X-Amz-Date: 2026-11-14T16:29:14Z\n",
            ),
        ),
        (
            "X-Amz-Date date other than the scope date".to_owned(),
            header_signed(
                &[&credential, signed, &signature],
                "X-Amz-Date: 20261115T162914Z\n",
            ),
        ),
        (
            "Date and no X-Amz-Date".to_owned(),
            header_signed(
                &[&credential, "SignedHeaders=date;host", &signature],
                "Date: Sat, 14 Nov 2026 16:29:14 GMT\n",
            ),
        ),
        (
            "header and query signature".to_owned(),
            format!(
                "GET /b1/k1?X-Amz-Signature={ANY_SIGNATURE} HTTP/1.1\nHost: {ENGINE_HOST}\n{amz_date}\
                 Authorization: AWS4-HMAC-SHA256 {credential}, {signed}, {signature}"
            ),
        ),
    ];
    let presign = client_form(&presign_head(), CLIENT_KEY_ID);
    let target = presign.lines().next().unwrap().split(' ').nth(1).unwrap();
    let (path, query) = target.split_once('?').unwrap();
    let pairs: Vec<&str> = query.split('&').collect();
    let head = |pairs: &[&str]| {
        format!(
            "GET {path}?{} HTTP/1.1\nHost: {ENGINE_HOST}",
            pairs.join("&")
        )
    };
    for (position, pair) in pairs.iter().enumerate() {
        let parameter = pair.split_once('=').unwrap().0;
        let mut without = pairs.clone();
        without.remove(position);
        forms.push((format!("query without {parameter}"), head(&without)));
        let mut twice = pairs.clone();
        twice.push(pair);
        forms.push((format!("query with {parameter} twice"), head(&twice)));
    }
    forms
}

#[tokio::test]
async fn prepare_other_forms_are_forwarded_as_received() {
    for (name, head) in other_forms() {
        let received = parts(&head);
        let prepared = prepared(&head).await.unwrap();
        let mut expected = received.headers.clone();
        expected.insert(HOST, HeaderValue::from_static(EMULATOR_HOST));
        assert_eq!(prepared.head.headers, expected, "{name}: headers");
        assert_eq!(prepared.head.uri, received.uri, "{name}: path and query");
        assert_eq!(prepared.head.method, received.method, "{name}: method");
    }
}

#[tokio::test]
async fn prepare_other_form_with_a_signed_chunk_mode_is_forwarded() {
    let head = format!(
        "PUT /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}\n\
         X-Amz-Content-SHA256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD\nContent-Length: 11"
    );
    let prepared = prepared(&head).await.unwrap();
    assert_eq!(
        prepared.head.headers.get("x-amz-content-sha256").unwrap(),
        "STREAMING-AWS4-HMAC-SHA256-PAYLOAD"
    );
    assert!(!prepared.head.headers.contains_key(AUTHORIZATION));
}

#[tokio::test]
async fn prepared_debug_of_a_header_signed_request_shows_no_authorization_value() {
    let prepared = prepared(&client_form(&vector_head("list-buckets"), CLIENT_KEY_ID))
        .await
        .unwrap();
    let debug = format!("{prepared:?}");
    let authorization = authorization(&prepared);
    assert!(!debug.contains(authorization), "{debug}");
    assert!(!debug.contains(signature_of(authorization)), "{debug}");
    assert!(!debug.contains(EMULATOR_KEY_ID), "{debug}");
    assert!(!debug.contains("AWS4-HMAC-SHA256"), "{debug}");
}

#[tokio::test]
async fn prepared_debug_of_a_query_signed_request_shows_no_query() {
    let prepared = prepared(&client_form(&presign_head(), CLIENT_KEY_ID))
        .await
        .unwrap();
    let debug = format!("{prepared:?}");
    let query = prepared.head.uri.query().unwrap();
    let signature = query.rsplit_once("X-Amz-Signature=").unwrap().1;
    assert!(!debug.contains(signature), "{debug}");
    assert!(!debug.contains(EMULATOR_KEY_ID), "{debug}");
    assert!(!debug.contains("X-Amz-"), "{debug}");
}

#[test]
fn relay_error_display_shows_a_code_and_kind_only() {
    let cases = [
        (
            "unavailable, not started",
            RelayError::Unavailable(Reason::NotStarted),
            "EmulatorUnavailable (not_started)",
        ),
        (
            "unavailable, files unreadable",
            RelayError::Unavailable(Reason::FilesUnreadable { file: CA_FILE }),
            "EmulatorUnavailable (files_unreadable)",
        ),
        (
            "unavailable, connection failed",
            RelayError::Unavailable(Reason::ConnectionFailed {
                kind: "connection reset".into(),
            }),
            "EmulatorUnavailable (connection_failed: connection reset)",
        ),
        (
            "client stalled",
            RelayError::ClientStalled,
            "RequestTimeout (client upload idle)",
        ),
        (
            "emulator stalled",
            RelayError::EmulatorStalled,
            "EmulatorTimeout (emulator upload idle)",
        ),
        (
            "client body failed",
            RelayError::ClientBodyFailed,
            "IncompleteBody (client body error)",
        ),
        (
            "head timeout",
            RelayError::HeadTimeout,
            "EmulatorTimeout (no response head)",
        ),
    ];
    for (name, error, shown) in cases {
        assert_eq!(error.to_string(), shown, "{name}");
    }
}

// ---------------------------------------------------------------------------------------------- TLS stand-in

struct Certificate {
    der: CertificateDer<'static>,
    pem: String,
    key: KeyPair,
}

/// A self-signed certificate for SAN `IP:127.0.0.1` under a fresh key: A is written to `ca.pem`, B is another.
fn certificate_a() -> Certificate {
    let key = KeyPair::generate().unwrap();
    let cert = CertificateParams::new(vec!["127.0.0.1".to_owned()])
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

/// The stand-in's side of one connection: a scripted HTTP/1.1 server over TLS.
struct Peer {
    tls: ServerTls<DuplexStream>,
    pending: Vec<u8>,
}

impl Peer {
    /// Reads more bytes; false at the end of the stream or on an error.
    async fn fill(&mut self) -> bool {
        let mut buffer = vec![0u8; 16 * 1024];
        match self.tls.read(&mut buffer).await {
            Ok(0) | Err(_) => false,
            Ok(read) => {
                self.pending.extend_from_slice(&buffer[..read]);
                true
            }
        }
    }

    /// The next request head, or `None` when the engine closed the connection.
    async fn head(&mut self) -> Option<String> {
        loop {
            if let Some(end) = self.pending.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&self.pending[..end]).into_owned();
                self.pending.drain(..end + 4);
                return Some(head);
            }
            if !self.fill().await {
                return None;
            }
        }
    }

    async fn line(&mut self) -> String {
        loop {
            if let Some(end) = self.pending.windows(2).position(|w| w == b"\r\n") {
                let line = String::from_utf8_lossy(&self.pending[..end]).into_owned();
                self.pending.drain(..end + 2);
                return line;
            }
            assert!(self.fill().await, "connection closed inside a chunk line");
        }
    }

    /// Exactly `len` bytes, handed to `each` as they arrive.
    async fn exact(&mut self, mut len: usize, mut each: impl FnMut(&[u8])) {
        while len > 0 {
            if self.pending.is_empty() {
                assert!(self.fill().await, "connection closed inside the body");
            }
            let take = len.min(self.pending.len());
            each(&self.pending[..take]);
            self.pending.drain(..take);
            len -= take;
        }
    }

    /// The request body of `head`, framed by `Content-Length` or chunked.
    async fn body(&mut self, head: &str) -> Vec<u8> {
        let mut body = Vec::new();
        if let Some(len) = header(head, "content-length") {
            self.exact(len.parse().unwrap(), |bytes| body.extend_from_slice(bytes))
                .await;
        } else if header(head, "transfer-encoding").as_deref() == Some("chunked") {
            loop {
                let size = usize::from_str_radix(&self.line().await, 16).unwrap();
                if size == 0 {
                    assert_eq!(self.line().await, "");
                    break;
                }
                self.exact(size, |bytes| body.extend_from_slice(bytes))
                    .await;
                assert_eq!(self.line().await, "");
            }
        }
        body
    }

    async fn write(&mut self, bytes: &[u8]) {
        self.tls.write_all(bytes).await.unwrap();
        self.tls.flush().await.unwrap();
    }

    /// Reads until the engine closes the connection; true once it did. Any request head on the way is counted.
    async fn closed(&mut self) -> bool {
        while self.fill().await {}
        true
    }
}

/// A header's value in a raw head, by lower-case name.
fn header(head: &str, name: &str) -> Option<String> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name)
            .then(|| value.trim().to_owned())
    })
}

/// The engine's side of a connection to a stand-in: TLS verified against certificate A, over an `IdleWrite`
/// whose flag is the exchange's `upstream_stalled`.
struct EngineSide {
    stream: ClientTls<IdleWrite<DuplexStream>>,
    stalled: Arc<AtomicBool>,
}

/// A stand-in running `script` over TLS on the far end of a duplex, and the engine's side of it.
async fn stand_in<F, Fut, T>(script: F) -> (EngineSide, JoinHandle<T>)
where
    F: FnOnce(Peer) -> Fut + Send + 'static,
    Fut: Future<Output = T> + Send,
    T: Send + 'static,
{
    let a = certificate_a();
    let (_home, emulator, files) = files_with(&a.pem).await;
    let (engine, server) = tokio::io::duplex(DUPLEX);
    let acceptor = acceptor(&a);
    let peer = tokio::spawn(async move {
        let tls = acceptor.accept(server).await.unwrap();
        script(Peer {
            tls,
            pending: Vec::new(),
        })
        .await
    });
    let idle = IdleWrite::new(engine, Limits::DEFAULT.upload_idle);
    let stalled = idle.stalled_flag();
    let stream = connect_on(idle, &emulator, &files, CONNECT_DEADLINE).await.unwrap();
    (EngineSide { stream, stalled }, peer)
}

fn get_head(path: &str) -> Prepared {
    put_head(path, None, "GET")
}

fn put_head(path: &str, content_length: Option<usize>, method: &str) -> Prepared {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, EMULATOR_HOST);
    if let Some(len) = content_length {
        builder = builder.header("content-length", len);
    }
    Prepared {
        head: builder.body(()).unwrap().into_parts().0,
    }
}

async fn exchange<B>(
    engine: EngineSide,
    prepared: Prepared,
    body: B,
) -> Result<Response<RelayBody>, RelayError>
where
    B: Body<Data = Bytes> + Send + Unpin + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    forward(
        engine.stream,
        engine.stalled,
        prepared,
        body,
        &Limits::DEFAULT,
    )
    .await
}

/// A client body fed frame by frame by the test; it ends when the sender is dropped.
struct ChannelBody(mpsc::Receiver<Result<Bytes, io::Error>>);

impl Body for ChannelBody {
    type Data = Bytes;
    type Error = io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        self.0
            .poll_recv(cx)
            .map(|item| item.map(|result| result.map(Frame::data)))
    }
}

fn channel_body() -> (mpsc::Sender<Result<Bytes, io::Error>>, ChannelBody) {
    let (sender, receiver) = mpsc::channel(4);
    (sender, ChannelBody(receiver))
}

/// The byte every position of frame `index` holds in the large bodies.
fn pattern(index: usize) -> u8 {
    u8::try_from(index % 251).unwrap()
}

/// A large client body made one frame at a time when polled; the test holds at most that one frame. Records the
/// most bytes it had handed over beyond what the stand-in received.
struct GeneratedBody {
    frames: usize,
    next: usize,
    received: Arc<AtomicUsize>,
    most_ahead: Arc<AtomicUsize>,
}

impl Body for GeneratedBody {
    type Data = Bytes;
    type Error = io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        if self.next == self.frames {
            return Poll::Ready(None);
        }
        let ahead = self.next * FRAME - self.received.load(Ordering::Acquire);
        self.most_ahead.fetch_max(ahead, Ordering::AcqRel);
        let frame = Bytes::from(vec![pattern(self.next); FRAME]);
        self.next += 1;
        Poll::Ready(Some(Ok(Frame::data(frame))))
    }

    fn is_end_stream(&self) -> bool {
        self.next == self.frames
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::with_exact(u64::try_from((self.frames - self.next) * FRAME).unwrap())
    }
}

fn header_names(headers: &HeaderMap) -> Vec<String> {
    let mut names: Vec<String> = headers
        .keys()
        .map(|name| name.as_str().to_owned())
        .collect();
    names.sort();
    names
}

// ---------------------------------------------------------------------------------------------- connect

#[tokio::test]
async fn connect_on_peer_presenting_the_ca_certificate_is_ok_and_writes_reach_it() {
    let a = certificate_a();
    let (_home, emulator, files) = files_with(&a.pem).await;
    let (engine, server) = tokio::io::duplex(DUPLEX);
    let acceptor = acceptor(&a);
    let peer = tokio::spawn(async move {
        let mut tls = acceptor.accept(server).await.unwrap();
        let mut received = [0u8; 4];
        tls.read_exact(&mut received).await.unwrap();
        received
    });
    let mut stream = connect_on(engine, &emulator, &files, CONNECT_DEADLINE).await.unwrap();
    stream.write_all(b"ping").await.unwrap();
    stream.flush().await.unwrap();
    assert_eq!(&peer.await.unwrap(), b"ping");
}

#[tokio::test]
async fn connect_on_peer_presenting_another_certificate_is_tls_untrusted() {
    let a = certificate_a();
    let b = certificate_a();
    let (_home, emulator, files) = files_with(&a.pem).await;
    let (engine, server) = tokio::io::duplex(DUPLEX);
    let acceptor = acceptor(&b);
    tokio::spawn(async move { acceptor.accept(server).await.is_ok() });
    assert_eq!(
        connect_on(engine, &emulator, &files, CONNECT_DEADLINE).await.err(),
        Some(Reason::TlsUntrusted)
    );
}

#[tokio::test(start_paused = true)]
async fn connect_on_handshake_never_completing_times_out_at_the_connect_deadline() {
    let a = certificate_a();
    let (_home, emulator, files) = files_with(&a.pem).await;
    let (engine, mut server) = tokio::io::duplex(DUPLEX);
    tokio::spawn(async move {
        let mut sink = [0u8; 4096];
        while matches!(server.read(&mut sink).await, Ok(read) if read > 0) {}
    });
    let start = Instant::now();
    let attempt = tokio::spawn(async move {
        let result = connect_on(engine, &emulator, &files, CONNECT_DEADLINE).await;
        (result.err(), Instant::now())
    });
    sleep(CONNECT_DEADLINE - MS).await;
    assert!(!attempt.is_finished(), "pending at 2 s - 1 ms");
    let (reason, at) = attempt.await.unwrap();
    assert_eq!(reason, Some(Reason::Timeout));
    assert_eq!(at - start, CONNECT_DEADLINE);
}

#[tokio::test]
async fn relay_without_emulator_directory_is_unavailable_not_started() {
    let home = tempfile::tempdir().unwrap();
    let request = Request::from_parts(parts(&vector_head("list-buckets")), Empty::<Bytes>::new());
    assert_eq!(
        relay(&emulator(home.path()), request, &Limits::DEFAULT)
            .await
            .unwrap_err(),
        RelayError::Unavailable(Reason::NotStarted)
    );
}

#[tokio::test]
async fn relay_with_malformed_ca_is_unavailable_files_unreadable() {
    let home = tempfile::tempdir().unwrap();
    write_files(home.path(), "not a certificate", CREDENTIALS);
    let request = Request::from_parts(parts(&vector_head("list-buckets")), Empty::<Bytes>::new());
    assert_eq!(
        relay(&emulator(home.path()), request, &Limits::DEFAULT)
            .await
            .unwrap_err(),
        RelayError::Unavailable(Reason::FilesUnreadable { file: CA_FILE })
    );
}

// ---------------------------------------------------------------------------------------------- forward

#[tokio::test(start_paused = true)]
async fn forward_passes_status_headers_and_body_without_hop_by_hop_headers() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nx-amz-request-id: R1\r\n\
              x-amz-checksum-crc64nvme: jSnVw/bqjr4=\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\n\
              Content-Length: 11\r\n\r\nhello",
        )
        .await;
        peer.write(b" ").await;
        peer.write(b"world").await;
        peer.closed().await
    })
    .await;
    let response = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header_names(response.headers()),
        [
            "content-length",
            "content-type",
            "x-amz-checksum-crc64nvme",
            "x-amz-request-id"
        ]
    );
    assert_eq!(response.headers()["content-type"], "application/xml");
    assert_eq!(response.headers()["x-amz-request-id"], "R1");
    assert_eq!(
        response.headers()["x-amz-checksum-crc64nvme"],
        "jSnVw/bqjr4="
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), b"hello world");
}

#[tokio::test(start_paused = true)]
async fn forward_passes_a_501_with_its_body() {
    const BODY: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Error><Code>NotImplemented</Code>\
                        <Message>A header you provided implies functionality that is not implemented</Message>\
                        <RequestId>R2</RequestId></Error>";
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        let answer = format!(
            "HTTP/1.1 501 Not Implemented\r\nContent-Type: application/xml\r\nx-amz-request-id: R2\r\n\
             Content-Length: {}\r\n\r\n{BODY}",
            BODY.len()
        );
        peer.write(answer.as_bytes()).await;
        peer.closed().await
    })
    .await;
    let response = exchange(engine, get_head("/b1?metadataTable"), Empty::<Bytes>::new())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
    assert_eq!(
        header_names(response.headers()),
        ["content-length", "content-type", "x-amz-request-id"]
    );
    assert_eq!(response.headers()["x-amz-request-id"], "R2");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), BODY.as_bytes());
}

#[tokio::test(start_paused = true)]
async fn forward_returns_a_redirect_without_following_it() {
    let (engine, peer) = stand_in(|mut peer| async move {
        let mut heads = 0;
        while peer.head().await.is_some() {
            heads += 1;
            if heads == 1 {
                peer.write(
                    b"HTTP/1.1 302 Found\r\nLocation: https://example.com/\r\nContent-Length: 0\r\n\r\n",
                )
                .await;
            }
        }
        heads
    })
    .await;
    let response = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    assert_eq!(response.headers()["location"], "https://example.com/");
    drop(response);
    assert_eq!(peer.await.unwrap(), 1, "exactly one request");
}

#[tokio::test]
async fn forward_streams_a_64_mib_upload_holding_one_frame() {
    let received = Arc::new(AtomicUsize::new(0));
    let most_ahead = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&received);
    let (engine, peer) = stand_in(move |mut peer| async move {
        let head = peer.head().await.unwrap();
        let mut offset = 0usize;
        let mut equal = true;
        peer.exact(
            header(&head, "content-length").unwrap().parse().unwrap(),
            |bytes| {
                equal &= bytes
                    .iter()
                    .enumerate()
                    .all(|(at, byte)| *byte == pattern((offset + at) / FRAME));
                offset += bytes.len();
                counter.store(offset, Ordering::Release);
            },
        )
        .await;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
        (offset, equal)
    })
    .await;
    let body = GeneratedBody {
        frames: LARGE / FRAME,
        next: 0,
        received: Arc::clone(&received),
        most_ahead: Arc::clone(&most_ahead),
    };
    let response = exchange(engine, put_head("/b1/large", Some(LARGE), "PUT"), body)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(peer.await.unwrap(), (LARGE, true), "64 MiB received, equal");
    let ahead = most_ahead.load(Ordering::Acquire);
    assert!(
        ahead <= UPLOAD_AHEAD_BOUND,
        "at most {ahead} bytes handed over ahead of the stand-in"
    );
}

#[tokio::test]
async fn forward_streams_a_64_mib_download_frame_by_frame() {
    let written = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&written);
    let (engine, _peer) = stand_in(move |mut peer| async move {
        peer.head().await.unwrap();
        peer.write(format!("HTTP/1.1 200 OK\r\nContent-Length: {LARGE}\r\n\r\n").as_bytes())
            .await;
        for index in 0..LARGE / FRAME {
            peer.write(&vec![pattern(index); FRAME]).await;
            counter.fetch_add(FRAME, Ordering::AcqRel);
        }
        peer.closed().await
    })
    .await;
    let response = exchange(engine, get_head("/b1/large"), Empty::<Bytes>::new())
        .await
        .unwrap();
    let mut body = response.into_body();
    let mut read = 0usize;
    let mut equal = true;
    let mut most_ahead = 0usize;
    while let Some(frame) = body.frame().await {
        let data = frame.unwrap().into_data().unwrap();
        equal &= data
            .iter()
            .enumerate()
            .all(|(at, byte)| *byte == pattern((read + at) / FRAME));
        read += data.len();
        most_ahead = most_ahead.max(written.load(Ordering::Acquire).saturating_sub(read));
    }
    assert_eq!(read, LARGE);
    assert!(equal, "the bytes are equal");
    assert!(
        most_ahead <= DUPLEX + FRAME,
        "{most_ahead} bytes written ahead of the reader"
    );
}

#[tokio::test(start_paused = true)]
async fn forward_keeps_content_length_or_chunked_framing() {
    // Content-Length: 10 and a 10-byte body.
    let (engine, peer) = stand_in(|mut peer| async move {
        let head = peer.head().await.unwrap();
        let body = peer.body(&head).await;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
        (head, body)
    })
    .await;
    let response = exchange(
        engine,
        put_head("/b1/k1", Some(10), "PUT"),
        Full::new(Bytes::from_static(b"0123456789")),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (head, body) = peer.await.unwrap();
    assert_eq!(
        header(&head, "content-length").as_deref(),
        Some("10"),
        "content length: {head}"
    );
    assert_eq!(
        header(&head, "transfer-encoding"),
        None,
        "content length: {head}"
    );
    assert_eq!(body, b"0123456789");

    // No Content-Length and a 3-frame body.
    let (engine, peer) = stand_in(|mut peer| async move {
        let head = peer.head().await.unwrap();
        let body = peer.body(&head).await;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
        (head, body)
    })
    .await;
    let (sender, body) = channel_body();
    for frame in ["abc", "def", "ghij"] {
        sender
            .send(Ok(Bytes::from_static(frame.as_bytes())))
            .await
            .unwrap();
    }
    drop(sender);
    let response = exchange(engine, put_head("/b1/k1", None, "PUT"), body)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (head, body) = peer.await.unwrap();
    assert_eq!(
        header(&head, "transfer-encoding").as_deref(),
        Some("chunked"),
        "chunked: {head}"
    );
    assert_eq!(header(&head, "content-length"), None, "chunked: {head}");
    assert_eq!(body, b"abcdefghij");
}

#[tokio::test(start_paused = true)]
async fn forward_empty_body_without_answer_is_head_timeout_at_60_s() {
    let (engine, _peer) = stand_in(|mut peer| async move { peer.closed().await }).await;
    let start = Instant::now();
    let call = tokio::spawn(async move {
        let result = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new()).await;
        (result.err(), Instant::now())
    });
    sleep(IDLE - MS).await;
    assert!(!call.is_finished(), "pending at 60 s - 1 ms");
    let (error, at) = call.await.unwrap();
    assert_eq!(error, Some(RelayError::HeadTimeout));
    assert_eq!(at - start, IDLE);
}

#[tokio::test(start_paused = true)]
async fn forward_answer_59_s_after_the_body_is_passed_on() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        let head = peer.head().await.unwrap();
        peer.body(&head).await;
        sleep(IDLE - Duration::from_secs(1)).await;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
        peer.closed().await
    })
    .await;
    let response = exchange(
        engine,
        put_head("/b1/k1", Some(10), "PUT"),
        Full::new(Bytes::from_static(b"0123456789")),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test(start_paused = true)]
async fn forward_body_sent_without_answer_is_head_timeout_60_s_after_the_last_byte() {
    let (engine, _peer) = stand_in(|mut peer| async move { peer.closed().await }).await;
    let (sender, body) = channel_body();
    let call = tokio::spawn(async move {
        let result = exchange(engine, put_head("/b1/k1", None, "PUT"), body).await;
        (result.err(), Instant::now())
    });
    sender.send(Ok(Bytes::from_static(b"first"))).await.unwrap();
    sleep(Duration::from_secs(10)).await;
    sender.send(Ok(Bytes::from_static(b"last"))).await.unwrap();
    drop(sender);
    let last_byte = Instant::now();
    sleep(IDLE - MS).await;
    assert!(
        !call.is_finished(),
        "pending at 60 s - 1 ms after the last byte"
    );
    let (error, at) = call.await.unwrap();
    assert_eq!(error, Some(RelayError::HeadTimeout));
    assert_eq!(at - last_byte, IDLE);
}

#[tokio::test(start_paused = true)]
async fn forward_client_body_pending_is_client_stalled_at_60_s_and_closes_upstream() {
    let (engine, peer) = stand_in(|mut peer| async move { peer.closed().await }).await;
    let (sender, body) = channel_body();
    sender.send(Ok(Bytes::from_static(b"first"))).await.unwrap();
    let start = Instant::now();
    let call = tokio::spawn(async move {
        let result = exchange(engine, put_head("/b1/k1", None, "PUT"), body).await;
        (result.err(), Instant::now())
    });
    sleep(IDLE - MS).await;
    assert!(!call.is_finished(), "pending at 60 s - 1 ms");
    let (error, at) = call.await.unwrap();
    assert_eq!(error, Some(RelayError::ClientStalled));
    assert_eq!(at - start, IDLE);
    assert!(peer.await.unwrap(), "the stand-in's connection is closed");
    drop(sender);
}

#[tokio::test(start_paused = true)]
async fn forward_client_pausing_59_s_between_frames_completes_the_upload() {
    let (engine, peer) = stand_in(|mut peer| async move {
        let head = peer.head().await.unwrap();
        let body = peer.body(&head).await;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await;
        body
    })
    .await;
    let (sender, body) = channel_body();
    let call = tokio::spawn(exchange(engine, put_head("/b1/k1", None, "PUT"), body));
    for frame in ["one", "two", "three"] {
        sender
            .send(Ok(Bytes::from_static(frame.as_bytes())))
            .await
            .unwrap();
        sleep(IDLE - Duration::from_secs(1)).await;
    }
    drop(sender);
    let response = call.await.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(peer.await.unwrap(), b"onetwothree");
}

#[tokio::test(start_paused = true)]
async fn forward_emulator_not_reading_the_upload_is_emulator_stalled_60_s_after_its_last_read() {
    let (engine, peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.exact(1024 * 1024, |_| {}).await;
        // Stops reading but keeps the connection open: the peer is returned, not dropped.
        (Instant::now(), peer)
    })
    .await;
    let body = GeneratedBody {
        frames: LARGE / FRAME,
        next: 0,
        received: Arc::new(AtomicUsize::new(0)),
        most_ahead: Arc::new(AtomicUsize::new(0)),
    };
    let call = tokio::spawn(async move {
        let result = exchange(engine, put_head("/b1/large", Some(LARGE), "PUT"), body).await;
        (result.err(), Instant::now())
    });
    let (last_read, _peer) = peer.await.unwrap();
    let (error, at) = call.await.unwrap();
    assert_eq!(error, Some(RelayError::EmulatorStalled));
    assert_eq!(at - last_read, IDLE);
}

#[tokio::test(start_paused = true)]
async fn forward_client_body_error_is_client_body_failed() {
    let (engine, _peer) = stand_in(|mut peer| async move { peer.closed().await }).await;
    let (sender, body) = channel_body();
    sender.send(Ok(Bytes::from_static(b"first"))).await.unwrap();
    sender
        .send(Err(io::Error::from(io::ErrorKind::ConnectionReset)))
        .await
        .unwrap();
    let error = exchange(engine, put_head("/b1/k1", None, "PUT"), body)
        .await
        .unwrap_err();
    assert_eq!(error, RelayError::ClientBodyFailed);
}

#[tokio::test(start_paused = true)]
async fn forward_emulator_closing_during_the_upload_is_unavailable_connection_failed() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.exact(LARGE / 2, |_| {}).await;
        drop(peer);
    })
    .await;
    let body = GeneratedBody {
        frames: LARGE / FRAME,
        next: 0,
        received: Arc::new(AtomicUsize::new(0)),
        most_ahead: Arc::new(AtomicUsize::new(0)),
    };
    let error = exchange(engine, put_head("/b1/large", Some(LARGE), "PUT"), body)
        .await
        .unwrap_err();
    assert!(
        matches!(
            error,
            RelayError::Unavailable(Reason::ConnectionFailed { .. })
        ),
        "{error:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn forward_early_answer_is_passed_on_with_connection_close() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.write(
            b"HTTP/1.1 403 Forbidden\r\nContent-Type: application/xml\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        peer.closed().await
    })
    .await;
    let (sender, body) = channel_body();
    sender.send(Ok(Bytes::from_static(b"first"))).await.unwrap();
    let response = exchange(engine, put_head("/b1/k1", None, "PUT"), body)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.headers()[CONNECTION], "close");
    assert_eq!(response.headers()["content-type"], "application/xml");
    drop(sender);
}

#[tokio::test(start_paused = true)]
async fn relay_body_without_a_byte_for_60_s_yields_an_error() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nfirst")
            .await;
        peer.closed().await
    })
    .await;
    let response = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new())
        .await
        .unwrap();
    let mut body = response.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(first.as_ref(), b"first");
    let start = Instant::now();
    let next = tokio::spawn(async move {
        let frame = body.frame().await;
        (frame.map(|frame| frame.is_err()), Instant::now())
    });
    sleep(IDLE - MS).await;
    assert!(!next.is_finished(), "pending at 60 s - 1 ms");
    let (is_error, at) = next.await.unwrap();
    assert_eq!(is_error, Some(true), "an error, not the end of the body");
    assert_eq!(at - start, IDLE);
}

#[tokio::test(start_paused = true)]
async fn relay_body_emulator_closing_mid_body_yields_an_error() {
    let (engine, _peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nfirst")
            .await;
        drop(peer);
    })
    .await;
    let response = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new())
        .await
        .unwrap();
    let mut body = response.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(first.as_ref(), b"first");
    assert!(
        matches!(body.frame().await, Some(Err(_))),
        "an error, not the end of the body"
    );
}

#[tokio::test(start_paused = true)]
async fn relay_body_dropped_after_the_head_closes_the_connection() {
    let (engine, peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
            .await;
        peer.closed().await
    })
    .await;
    let response = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new())
        .await
        .unwrap();
    drop(response);
    assert!(
        peer.await.unwrap(),
        "the stand-in observes its connection closed"
    );
}

#[tokio::test(start_paused = true)]
async fn forward_dropped_while_waiting_for_the_head_leaves_no_task() {
    let metrics = tokio::runtime::Handle::current().metrics();
    let before = metrics.num_alive_tasks();
    let (engine, peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        peer.closed().await
    })
    .await;
    let call = exchange(engine, get_head("/b1/k1"), Empty::<Bytes>::new());
    assert!(
        tokio::time::timeout(Duration::from_secs(1), call)
            .await
            .is_err(),
        "still waiting for the head, then dropped"
    );
    assert!(
        peer.await.unwrap(),
        "the stand-in observes its connection closed"
    );
    for _ in 0..10 {
        if metrics.num_alive_tasks() == before {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(metrics.num_alive_tasks(), before, "no task remains");
}

/// A stand-in that answers every request head `200` and counts the heads until the engine closes.
async fn count_requests(mut peer: Peer) -> usize {
    let mut heads = 0;
    while peer.head().await.is_some() {
        heads += 1;
        peer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            .await;
    }
    heads
}

#[tokio::test(start_paused = true)]
async fn forward_twice_uses_one_connection_per_exchange() {
    let mut peers = Vec::new();
    for _ in 0..2 {
        let (engine, peer) = stand_in(count_requests).await;
        let response = exchange(engine, get_head("/"), Empty::<Bytes>::new())
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(body.as_ref(), b"ok");
        peers.push(peer);
    }
    for peer in peers {
        assert_eq!(peer.await.unwrap(), 1, "exactly one request per stand-in");
    }
}

#[tokio::test(start_paused = true)]
async fn forward_after_a_head_timeout_serves_the_next_exchange() {
    let (engine, _silent) = stand_in(|mut peer| async move { peer.closed().await }).await;
    assert_eq!(
        exchange(engine, get_head("/"), Empty::<Bytes>::new())
            .await
            .unwrap_err(),
        RelayError::HeadTimeout
    );
    let (engine, _peer) = stand_in(count_requests).await;
    let response = exchange(engine, get_head("/"), Empty::<Bytes>::new())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------------------------- signed chunks (issue 9)

const SIGNED_CHUNKS: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
const SIGNED_CHUNKS_TRAILER: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
/// The payload hash of the `put-object-k1` prepare vector.
const K1_PAYLOAD_HASH: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
const CHUNK_SIGNATURE_EXTENSION: &str = ";chunk-signature=";
const ZERO_SIGNATURE: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MIB: usize = 1_048_576;

/// True when `text` holds 64 hex characters in a row.
fn has_64_hex(text: &str) -> bool {
    let mut run = 0;
    for byte in text.bytes() {
        run = if byte.is_ascii_hexdigit() { run + 1 } else { 0 };
        if run >= 64 {
            return true;
        }
    }
    false
}

/// `put-object-k1` in client form, its `X-Amz-Content-SHA256` replaced by `mode`.
fn k1_with_mode(mode: &str) -> String {
    client_form(&vector_head("put-object-k1"), CLIENT_KEY_ID).replace(
        &format!("X-Amz-Content-SHA256: {K1_PAYLOAD_HASH}"),
        &format!("X-Amz-Content-SHA256: {mode}"),
    )
}

/// Re-signed as #2 prepares a header-signed head: the emulator as `Host`, `Authorization` with the emulator's
/// key id and a new signature, `X-Amz-Content-SHA256` as received.
fn assert_resigned(prepared: &Prepared, mode: &str, case: &str) {
    assert_eq!(prepared.head.headers[HOST], EMULATOR_HOST, "case {case}");
    let authorization = authorization(prepared);
    assert!(
        authorization.starts_with(&format!(
            "AWS4-HMAC-SHA256 Credential={EMULATOR_KEY_ID}/20261114/us-east-1/s3/aws4_request, SignedHeaders="
        )),
        "case {case}: {authorization}"
    );
    assert_ne!(signature_of(authorization), ANY_SIGNATURE, "case {case}");
    assert_eq!(
        prepared.head.headers["x-amz-content-sha256"], mode,
        "case {case}"
    );
}

fn has_chunk_signing(prepared: &Prepared) -> bool {
    prepared.head.extensions.get::<ChunkSigning>().is_some()
}

#[tokio::test]
async fn prepare_hmac_signed_chunk_modes_resign_the_head_and_attach_a_chunk_signing() {
    for mode in [SIGNED_CHUNKS, SIGNED_CHUNKS_TRAILER] {
        let prepared = prepared(&k1_with_mode(mode)).await.unwrap();
        assert_resigned(&prepared, mode, mode);
        assert!(has_chunk_signing(&prepared), "case {mode}: no ChunkSigning");
    }
}

#[tokio::test]
async fn prepare_signed_chunks_attach_a_chunk_signing_whatever_the_content_encoding() {
    let cases = [
        ("no Content-Encoding", None),
        ("gzip,aws-chunked", Some("gzip,aws-chunked")),
        ("AWS-CHUNKED", Some("AWS-CHUNKED")),
    ];
    for (case, encoding) in cases {
        let mut head = k1_with_mode(SIGNED_CHUNKS);
        if let Some(encoding) = encoding {
            head.push_str(&format!("\nContent-Encoding: {encoding}"));
        }
        let prepared = prepared(&head).await.unwrap();
        assert!(has_chunk_signing(&prepared), "case {case}: no ChunkSigning");
        assert_eq!(
            prepared
                .head
                .headers
                .get("content-encoding")
                .map(|value| value.to_str().unwrap()),
            encoding,
            "case {case}: Content-Encoding as received"
        );
    }
}

#[tokio::test]
async fn prepare_other_payload_modes_attach_no_chunk_signing() {
    for mode in [
        "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD",
        "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER",
        "STREAMING-AWS4-HMAC-SHA256-payload",
    ] {
        let prepared = prepared(&k1_with_mode(mode)).await.unwrap();
        assert_resigned(&prepared, mode, mode);
        assert!(!has_chunk_signing(&prepared), "case {mode}: a ChunkSigning");
    }
}

#[tokio::test]
async fn prepare_query_signed_and_other_forms_in_signed_chunks_attach_no_chunk_signing() {
    // Query-signed: the header is not among the signed ones, so the query is the captured one.
    let captured = presign_head();
    let client = format!(
        "{}\nX-Amz-Content-SHA256: {SIGNED_CHUNKS}",
        client_form(&captured, CLIENT_KEY_ID)
    );
    let query = prepared(&client).await.unwrap();
    assert_eq!(query.head.uri, parts(&captured).uri, "case query-signed");
    assert!(
        !query.head.headers.contains_key(AUTHORIZATION),
        "case query-signed"
    );
    assert!(!has_chunk_signing(&query), "case query-signed");

    // Other: no signature at all, forwarded as received.
    let head = format!(
        "PUT /b1/k1 HTTP/1.1\nHost: {ENGINE_HOST}\nX-Amz-Content-SHA256: {SIGNED_CHUNKS}\nContent-Length: 11"
    );
    let received = parts(&head);
    let other = prepared(&head).await.unwrap();
    let mut expected = received.headers.clone();
    expected.insert(HOST, HeaderValue::from_static(EMULATOR_HOST));
    assert_eq!(other.head.headers, expected, "case other");
    assert!(!has_chunk_signing(&other), "case other");
}

#[tokio::test]
async fn prepared_debug_with_a_chunk_signing_shows_no_64_hex() {
    let prepared = prepared(&k1_with_mode(SIGNED_CHUNKS)).await.unwrap();
    assert!(has_chunk_signing(&prepared));
    let debug = format!("{prepared:?}");
    assert!(!has_64_hex(&debug), "{debug}");
}

#[test]
fn relay_error_chunk_too_large_display_is_its_code_and_kind() {
    assert_eq!(
        RelayError::ChunkTooLarge.to_string(),
        "ChunkTooLarge (chunk above the cap)"
    );
}

/// The chunk vector (`tests/vectors/s3-signed-chunks.txt`, S3 API Reference "Transferring payload in multiple
/// chunks"), as its file gives it.
struct ChunkVector {
    secret: String,
    amz_date: String,
    scope: Scope,
    seed: String,
    byte: u8,
    sizes: Vec<usize>,
    signatures: Vec<String>,
    content_length: usize,
}

impl ChunkVector {
    fn load() -> ChunkVector {
        let vector = sections("s3-signed-chunks.txt");
        let get = |name: &str| vector[name].clone();
        let scope: Vec<String> = get("scope").split('/').map(str::to_owned).collect();
        ChunkVector {
            secret: get("secret"),
            amz_date: get("amz-date"),
            scope: Scope {
                date: scope[0].clone(),
                region: scope[1].clone(),
                service: scope[2].clone(),
            },
            seed: get("seed-signature"),
            byte: get("data-byte").as_bytes()[0],
            sizes: get("chunk-sizes")
                .lines()
                .map(|size| size.parse().unwrap())
                .collect(),
            signatures: get("chunk-signatures").lines().map(str::to_owned).collect(),
            content_length: get("content-length").parse().unwrap(),
        }
    }

    /// The body in the page's framing, every chunk signed with `signature(index)`.
    fn body_with(&self, signature: impl Fn(usize) -> String) -> Vec<u8> {
        let mut body = Vec::new();
        for (index, &size) in self.sizes.iter().enumerate() {
            body.extend_from_slice(
                format!(
                    "{size:x}{CHUNK_SIGNATURE_EXTENSION}{}\r\n",
                    signature(index)
                )
                .as_bytes(),
            );
            body.extend(std::iter::repeat_n(self.byte, size));
            body.extend_from_slice(b"\r\n");
        }
        assert_eq!(body.len(), self.content_length, "the page's Content-Length");
        body
    }

    /// The body as the page sends it.
    fn body(&self) -> Vec<u8> {
        self.body_with(|index| self.signatures[index].clone())
    }

    /// The body with every chunk signature 64 `0` characters.
    fn zeroed(&self) -> Vec<u8> {
        self.body_with(|_| ZERO_SIGNATURE.to_owned())
    }

    /// The vector's `ChunkSigning`, its secret read from emulator files in a temp home.
    async fn signing(&self) -> ChunkSigning {
        let home = tempfile::tempdir().unwrap();
        write_files(
            home.path(),
            &certificate_a().pem,
            &format!(
                "[default]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = {}\n",
                self.secret
            ),
        );
        let files = EmulatorFiles::read(&emulator(home.path())).await.unwrap();
        ChunkSigning::new(
            signing_key(&files.credentials().secret_access_key, &self.scope),
            self.amz_date.clone(),
            self.scope.clone(),
            self.seed.clone(),
            false,
        )
    }
}

/// A PUT head with `content_length` and `signing` in its extensions.
fn signed_put_head(content_length: Option<usize>, signing: ChunkSigning) -> Prepared {
    let mut prepared = put_head("/examplebucket/chunkObject.txt", content_length, "PUT");
    prepared.head.extensions.insert(signing);
    prepared
}

/// A client body sending `frames`, then ending.
async fn frames_body(frames: Vec<Vec<u8>>) -> ChannelBody {
    let (sender, receiver) = mpsc::channel(frames.len().max(1));
    for frame in frames {
        sender.send(Ok(Bytes::from(frame))).await.unwrap();
    }
    ChannelBody(receiver)
}

/// `body` cut into three frames.
fn three_frames(body: &[u8]) -> Vec<Vec<u8>> {
    let third = body.len() / 3;
    vec![
        body[..third].to_vec(),
        body[third..2 * third].to_vec(),
        body[2 * third..].to_vec(),
    ]
}

/// A stand-in that records the request head and body and answers `200` with a small XML body.
async fn record_and_answer(mut peer: Peer) -> (String, Vec<u8>) {
    let head = peer.head().await.unwrap();
    let body = peer.body(&head).await;
    peer.write(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nx-amz-request-id: R9\r\n\
          ETag: \"e9b\"\r\nContent-Length: 4\r\n\r\ndone",
    )
    .await;
    (head, body)
}

/// The header names of a raw head, lower-cased and sorted.
fn raw_header_names(head: &str) -> Vec<String> {
    let mut names: Vec<String> = head
        .lines()
        .skip(1)
        .map(|line| line.split_once(':').unwrap().0.to_ascii_lowercase())
        .collect();
    names.sort();
    names
}

#[tokio::test(start_paused = true)]
async fn forward_with_a_chunk_signing_sends_the_vector_body_with_its_content_length() {
    let vector = ChunkVector::load();
    let (engine, peer) = stand_in(record_and_answer).await;
    let prepared = signed_put_head(Some(vector.content_length), vector.signing().await);
    let sent_names = header_names(&prepared.head.headers);
    let body = frames_body(three_frames(&vector.zeroed())).await;
    let response = exchange(engine, prepared, body).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-amz-request-id"], "R9");
    assert_eq!(response.headers()["etag"], "\"e9b\"");
    let answer = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(answer.as_ref(), b"done");
    let (head, received) = peer.await.unwrap();
    assert_eq!(
        header(&head, "content-length").unwrap(),
        vector.content_length.to_string()
    );
    assert_eq!(raw_header_names(&head), sent_names, "{head}");
    assert!(
        received == vector.body(),
        "the chunk vector body, byte for byte"
    );
}

#[tokio::test(start_paused = true)]
async fn forward_with_a_chunk_signing_and_no_content_length_sends_it_chunked() {
    let vector = ChunkVector::load();
    let (engine, peer) = stand_in(record_and_answer).await;
    let prepared = signed_put_head(None, vector.signing().await);
    let body = frames_body(three_frames(&vector.zeroed())).await;
    let response = exchange(engine, prepared, body).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (head, received) = peer.await.unwrap();
    assert_eq!(
        header(&head, "transfer-encoding").as_deref(),
        Some("chunked"),
        "{head}"
    );
    assert_eq!(header(&head, "content-length"), None, "{head}");
    assert!(received == vector.body(), "the chunk vector body, decoded");
}

#[tokio::test(start_paused = true)]
async fn forward_without_a_chunk_signing_sends_the_body_unchanged() {
    let vector = ChunkVector::load();
    let (engine, peer) = stand_in(record_and_answer).await;
    let prepared = put_head(
        "/examplebucket/chunkObject.txt",
        Some(vector.content_length),
        "PUT",
    );
    let body = frames_body(three_frames(&vector.zeroed())).await;
    let response = exchange(engine, prepared, body).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (_head, received) = peer.await.unwrap();
    assert!(received == vector.zeroed(), "the zeroed body, unchanged");
}

#[tokio::test(start_paused = true)]
async fn forward_chunk_above_the_cap_is_chunk_too_large_after_the_chunks_before_it() {
    let vector = ChunkVector::load();
    let zeroed = vector.zeroed();
    let signed = vector.body();
    // The vector's first chunk: its header line, 65536 data bytes and `\r\n`.
    let first_len = zeroed
        .windows(2)
        .enumerate()
        .filter(|(_, pair)| *pair == b"\r\n")
        .map(|(at, _)| at + 2)
        .nth(1)
        .unwrap();
    let too_large = format!("100001{CHUNK_SIGNATURE_EXTENSION}{ZERO_SIGNATURE}\r\n");
    let content_length = first_len + too_large.len() + (MIB + 1) + 2 + 86;
    let (first_received, first_rx) = tokio::sync::oneshot::channel();
    let (engine, peer) = stand_in(move |mut peer| async move {
        let head = peer.head().await.unwrap();
        let mut body = Vec::new();
        peer.exact(first_len, |bytes| body.extend_from_slice(bytes))
            .await;
        first_received.send(()).unwrap();
        while peer.fill().await {}
        body.extend_from_slice(&peer.pending);
        (head, body)
    })
    .await;
    let (sender, body) = channel_body();
    let prepared = signed_put_head(Some(content_length), vector.signing().await);
    let call = tokio::spawn(exchange(engine, prepared, body));
    sender
        .send(Ok(Bytes::from(zeroed[..first_len].to_vec())))
        .await
        .unwrap();
    first_rx.await.unwrap();
    sender
        .send(Ok(Bytes::from(too_large.into_bytes())))
        .await
        .unwrap();
    assert_eq!(call.await.unwrap().unwrap_err(), RelayError::ChunkTooLarge);
    let (head, received) = peer.await.unwrap();
    assert_eq!(
        header(&head, "content-length").unwrap(),
        content_length.to_string()
    );
    assert!(
        received[..first_len] == signed[..first_len],
        "the first chunk, re-signed"
    );
    assert!(
        received.len() < content_length,
        "the request ended before its Content-Length: {} of {content_length}",
        received.len()
    );
    drop(sender);
}

/// A 1 MiB chunk with a zero signature, its data `pattern(0)`.
fn mib_chunk_header() -> Vec<u8> {
    format!("100000{CHUNK_SIGNATURE_EXTENSION}{ZERO_SIGNATURE}\r\n").into_bytes()
}

fn final_chunk() -> Vec<u8> {
    format!("\r\n0{CHUNK_SIGNATURE_EXTENSION}{ZERO_SIGNATURE}\r\n\r\n").into_bytes()
}

#[tokio::test(start_paused = true)]
async fn forward_client_sending_a_chunk_in_pieces_30_s_apart_is_not_timed_out() {
    let vector = ChunkVector::load();
    let header_line = mib_chunk_header();
    let content_length = header_line.len() + MIB + final_chunk().len();
    let (engine, peer) = stand_in(record_and_answer).await;
    let (sender, body) = channel_body();
    let prepared = signed_put_head(Some(content_length), vector.signing().await);
    let call = tokio::spawn(exchange(engine, prepared, body));
    sender
        .send(Ok(Bytes::from(header_line.clone())))
        .await
        .unwrap();
    for _ in 0..4 {
        sleep(Duration::from_secs(30)).await;
        sender
            .send(Ok(Bytes::from(vec![pattern(0); MIB / 4])))
            .await
            .unwrap();
    }
    sender.send(Ok(Bytes::from(final_chunk()))).await.unwrap();
    drop(sender);
    let response = call.await.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-amz-request-id"], "R9");
    let (_head, received) = peer.await.unwrap();
    assert_eq!(received.len(), content_length, "the whole body");
    let data_at = header_line.len();
    assert!(
        received[data_at..data_at + MIB]
            .iter()
            .all(|&byte| byte == pattern(0)),
        "the chunk's data"
    );
}

#[tokio::test(start_paused = true)]
async fn forward_client_stopping_mid_chunk_is_client_stalled_at_60_s_before_any_chunk_byte() {
    let vector = ChunkVector::load();
    let header_line = mib_chunk_header();
    let content_length = header_line.len() + MIB + final_chunk().len();
    let (engine, peer) = stand_in(|mut peer| async move {
        peer.head().await.unwrap();
        while peer.fill().await {}
        peer.pending
    })
    .await;
    let (sender, body) = channel_body();
    sender.send(Ok(Bytes::from(header_line))).await.unwrap();
    sender
        .send(Ok(Bytes::from(vec![pattern(0); MIB / 2])))
        .await
        .unwrap();
    let prepared = signed_put_head(Some(content_length), vector.signing().await);
    let start = Instant::now();
    let call = tokio::spawn(async move {
        let result = exchange(engine, prepared, body).await;
        (result.err(), Instant::now())
    });
    sleep(IDLE - MS).await;
    assert!(!call.is_finished(), "pending at 60 s - 1 ms");
    let (error, at) = call.await.unwrap();
    assert_eq!(error, Some(RelayError::ClientStalled));
    assert_eq!(at - start, IDLE);
    let received = peer.await.unwrap();
    assert!(
        received.is_empty(),
        "the stand-in received {} bytes of the chunk",
        received.len()
    );
    drop(sender);
}

/// The steps `relay` takes for one request (read this request's files, prepare, connect, forward), over a duplex
/// to a recording stand-in instead of a socket: what the emulator receives for `head` and `body` when the files in
/// `home` hold `credentials` and the CA of `certificate`.
async fn relayed_with(
    home: &Path,
    certificate: &Certificate,
    credentials: &str,
    head: &str,
    body: Vec<u8>,
) -> (String, Vec<u8>) {
    write_files(home, &certificate.pem, credentials);
    let emulator = emulator(home);
    let files = EmulatorFiles::read(&emulator).await.unwrap();
    let prepared = prepare(parts(head), &emulator, files.credentials()).unwrap();
    let (engine, server) = tokio::io::duplex(DUPLEX);
    let acceptor = acceptor(certificate);
    let peer = tokio::spawn(async move {
        let tls = acceptor.accept(server).await.unwrap();
        record_and_answer(Peer {
            tls,
            pending: Vec::new(),
        })
        .await
    });
    let idle = IdleWrite::new(engine, Limits::DEFAULT.upload_idle);
    let stalled = idle.stalled_flag();
    let stream = connect_on(idle, &emulator, &files, CONNECT_DEADLINE).await.unwrap();
    drop(files);
    let response = forward(
        stream,
        stalled,
        prepared,
        Full::new(Bytes::from(body)),
        &Limits::DEFAULT,
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    peer.await.unwrap()
}

#[tokio::test(start_paused = true)]
async fn relay_after_the_credentials_change_signs_the_chain_with_the_new_key() {
    let vector = ChunkVector::load();
    let zeroed = vector.zeroed();
    let head = format!(
        "{}\nContent-Length: {}",
        k1_with_mode(SIGNED_CHUNKS),
        zeroed.len()
    );
    let home = tempfile::tempdir().unwrap();
    let certificate = certificate_a();
    let other_credentials = "[default]\naws_access_key_id = EMUKEYID000000000002\n\
                             aws_secret_access_key = emuforgeUnitTestSecretKey000000000000002\n";
    let (first_head, first) = relayed_with(
        home.path(),
        &certificate,
        CREDENTIALS,
        &head,
        zeroed.clone(),
    )
    .await;
    let (second_head, second) =
        relayed_with(home.path(), &certificate, other_credentials, &head, zeroed).await;

    for (received, key_id) in [
        (&first_head, EMULATOR_KEY_ID),
        (&second_head, "EMUKEYID000000000002"),
    ] {
        let authorization = header(received, "authorization").unwrap();
        assert!(
            authorization.starts_with(&format!("AWS4-HMAC-SHA256 Credential={key_id}/")),
            "{authorization}"
        );
    }
    assert_eq!(first.len(), second.len());
    let signature_ranges: Vec<std::ops::Range<usize>> = first
        .windows(CHUNK_SIGNATURE_EXTENSION.len())
        .enumerate()
        .filter(|(_, window)| *window == CHUNK_SIGNATURE_EXTENSION.as_bytes())
        .map(|(at, _)| {
            let start = at + CHUNK_SIGNATURE_EXTENSION.len();
            start..start + 64
        })
        .collect();
    assert_eq!(signature_ranges.len(), vector.sizes.len(), "one per chunk");
    for range in &signature_ranges {
        assert_ne!(
            first[range.clone()],
            second[range.clone()],
            "the chunk signature at {range:?} differs"
        );
    }
    for (at, (a, b)) in first.iter().zip(&second).enumerate() {
        if a != b {
            assert!(
                signature_ranges.iter().any(|range| range.contains(&at)),
                "byte {at} differs outside a chunk signature"
            );
        }
    }
}

/// A client body that records whether it was ever polled.
struct PolledBody(Arc<AtomicBool>);

impl Body for PolledBody {
    type Data = Bytes;
    type Error = io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        self.0.store(true, Ordering::SeqCst);
        Poll::Ready(None)
    }
}

#[tokio::test]
async fn relay_signed_chunk_upload_without_emulator_files_is_unavailable_before_the_body_is_read() {
    let home = tempfile::tempdir().unwrap();
    let polled = Arc::new(AtomicBool::new(false));
    let request = Request::from_parts(
        parts(&k1_with_mode(SIGNED_CHUNKS)),
        PolledBody(polled.clone()),
    );
    assert_eq!(
        relay(&emulator(home.path()), request, &Limits::DEFAULT)
            .await
            .unwrap_err(),
        RelayError::Unavailable(Reason::NotStarted)
    );
    assert!(!polled.load(Ordering::SeqCst), "the body was polled");
}
