#![cfg(test)]

use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use emuforge_core::check::{CREDENTIALS_BODY, credentials_request, test, test_over};
use emuforge_core::{
    CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles, Outcome, PROBE_DEADLINE, Reason, Step,
    TestReport,
};
use http_body_util::BodyExt;
use rcgen::{CertificateParams, KeyPair};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tempfile::TempDir;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

/// The stand-in emulator key of the prepare vectors and of `vectors/sts-get-caller-identity.txt`.
const KEY_ID: &str = "EMUKEYID000000000001";
const SECRET: &str = "emuforgeUnitTestSecretKey000000000000001";
const CREDENTIALS: &str = "[default]\naws_access_key_id = EMUKEYID000000000001\n\
                           aws_secret_access_key = emuforgeUnitTestSecretKey000000000000001\n";
const OK: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok";
const STS_OK: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-type: text/xml\r\ncontent-length: 21\r\n\r\n<GetCallerIdentity/>\n";
const FORBIDDEN: &[u8] = b"HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n";
const SERVER_ERROR: &[u8] = b"HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n";
const UNAVAILABLE: &[u8] = b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\n\r\n";
/// The emulator port of the tests over a stand-in; nothing listens on it, the stand-in is dialed in memory.
const PORT: u16 = 9391;
/// The vector's time, 2026-11-19T12:00:00Z.
const VECTOR_NOW: u64 = 1_795_089_600;

struct Certificate {
    der: CertificateDer<'static>,
    pem: String,
    key: KeyPair,
}

fn certificate() -> Certificate {
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

fn now() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(VECTOR_NOW)
}

fn write_files(emulator: &Emulator, ca: &str) {
    fs::create_dir_all(emulator.dir()).unwrap();
    fs::write(emulator.dir().join(CA_FILE), ca).unwrap();
    fs::write(emulator.dir().join(CREDENTIALS_FILE), CREDENTIALS).unwrap();
}

/// How the stand-in answers each of the two requests a test sends; `None` never answers.
#[derive(Clone, Copy)]
struct Answers {
    health: Option<&'static [u8]>,
    sts: Option<&'static [u8]>,
}

const ALL_OK: Answers = Answers {
    health: Some(OK),
    sts: Some(STS_OK),
};

/// One request the stand-in received: its head and its body.
#[derive(Debug, Clone)]
struct Received {
    head: String,
    body: Vec<u8>,
}

impl Received {
    fn request_line(&self) -> &str {
        self.head.lines().next().unwrap_or("")
    }

    fn header(&self, name: &str) -> Option<String> {
        self.head.lines().skip(1).find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case(name)
                .then(|| value.trim().to_owned())
        })
    }
}

/// A TLS stand-in for the emulator, presenting `presented`: each dial opens a new in-memory connection to it.
#[derive(Clone)]
struct StandIn {
    acceptor: TlsAcceptor,
    answers: Answers,
    received: Arc<Mutex<Vec<Received>>>,
    connections: Arc<Mutex<usize>>,
}

impl StandIn {
    fn new(presented: &Certificate, answers: Answers) -> StandIn {
        StandIn {
            acceptor: acceptor(presented),
            answers,
            received: Arc::new(Mutex::new(Vec::new())),
            connections: Arc::new(Mutex::new(0)),
        }
    }

    /// The dialer `test_over` calls: one new connection per call.
    fn dial(&self) -> impl FnMut() -> std::future::Ready<std::io::Result<DuplexStream>> + use<> {
        let stand_in = self.clone();
        move || {
            let (client, server) = tokio::io::duplex(64 * 1024);
            *stand_in.connections.lock().unwrap() += 1;
            let (acceptor, answers, seen) = (
                stand_in.acceptor.clone(),
                stand_in.answers,
                stand_in.received.clone(),
            );
            tokio::spawn(async move {
                if let Ok(tls) = acceptor.accept(server).await {
                    serve(tls, answers, seen).await;
                }
            });
            std::future::ready(Ok(client))
        }
    }

    fn received(&self) -> Vec<Received> {
        self.received.lock().unwrap().clone()
    }

    fn connections(&self) -> usize {
        *self.connections.lock().unwrap()
    }
}

/// Reads requests (head and `content-length` body) until the client goes away, answering each per `answers`.
async fn serve<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    answers: Answers,
    seen: Arc<Mutex<Vec<Received>>>,
) {
    let mut pending = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        while let Some(end) = pending.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&pending[..end]).into_owned();
            let length = Received {
                head: head.clone(),
                body: Vec::new(),
            }
            .header("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
            while pending.len() < end + 4 + length {
                match stream.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(read) => pending.extend_from_slice(&buffer[..read]),
                }
            }
            let body = pending[end + 4..end + 4 + length].to_vec();
            pending.drain(..end + 4 + length);
            let answer = if head.starts_with("GET /__admin/health ") {
                answers.health
            } else {
                answers.sts
            };
            seen.lock().unwrap().push(Received { head, body });
            match answer {
                Some(answer) => {
                    if stream.write_all(answer).await.is_err() {
                        return;
                    }
                }
                // Never answer; keep reading until the client goes away.
                None => {
                    while matches!(stream.read(&mut buffer).await, Ok(read) if read > 0) {}
                    return;
                }
            }
        }
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => pending.extend_from_slice(&buffer[..read]),
        }
    }
}

/// A temp home with the emulator files for `port`, `ca.pem` holding `ca`.
fn home_for(port: u16, ca: &Certificate) -> (TempDir, Emulator) {
    let home = tempfile::tempdir().unwrap();
    let emulator = Emulator::new(home.path(), NonZeroU16::new(port).unwrap());
    write_files(&emulator, &ca.pem);
    (home, emulator)
}

fn outcomes(report: &TestReport) -> Vec<(&'static str, Outcome)> {
    report
        .checks
        .iter()
        .map(|(step, outcome)| (step.name(), outcome.clone()))
        .collect()
}

/// The expected outcomes when `failed` fails with `reason`: the steps before it passed, the ones after not run.
fn failed_at(failed: Step, reason: Reason) -> Vec<(&'static str, Outcome)> {
    let mut reason = Some(reason);
    let mut reached = false;
    Step::ALL
        .iter()
        .map(|step| {
            let outcome = if *step == failed {
                reached = true;
                Outcome::Failed(reason.take().unwrap())
            } else if reached {
                Outcome::NotRun
            } else {
                Outcome::Passed
            };
            (step.name(), outcome)
        })
        .collect()
}

/// Tests the emulator on [`PORT`] over connections to a stand-in presenting the certificate of its `ca.pem`.
async fn run_against(answers: Answers) -> (TestReport, Vec<Received>, usize) {
    let ca = certificate();
    let server = StandIn::new(&ca, answers);
    let (_home, emulator) = home_for(PORT, &ca);
    let report = test_over(&emulator, PROBE_DEADLINE, now(), server.dial()).await;
    (report, server.received(), server.connections())
}

// Given a test TLS server on loopback, a temp emulator folder with its `ca.pem` and a known key, and a fixed `now`

#[tokio::test(start_paused = true)]
async fn test_healthy_emulator_accepting_the_key_passes_every_step_in_order() {
    let (report, _, _) = run_against(ALL_OK).await;
    let steps: Vec<&str> = report.checks.iter().map(|(step, _)| step.name()).collect();
    assert_eq!(
        steps,
        ["files", "connection", "tls", "health", "credentials"]
    );
    assert!(
        report
            .checks
            .iter()
            .all(|(_, outcome)| outcome.status() == "passed"),
        "{report:?}"
    );
    assert!(report.passed());
}

#[tokio::test(start_paused = true)]
async fn test_without_emulator_files_fails_at_files_not_started() {
    let home = tempfile::tempdir().unwrap();
    let emulator = Emulator::new(home.path(), NonZeroU16::new(9306).unwrap());
    let report = test(&emulator, PROBE_DEADLINE, now()).await;
    assert_eq!(
        outcomes(&report),
        failed_at(Step::Files, Reason::NotStarted)
    );
    assert_eq!(report.checks[0].1.reason().unwrap().code(), "not_started");
    assert!(
        report.checks[1..]
            .iter()
            .all(|(_, outcome)| outcome.status() == "not_run")
    );
    assert!(!report.passed());
}

#[tokio::test(start_paused = true)]
async fn test_with_nothing_listening_fails_at_connection_refused() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let (_home, emulator) = home_for(addr.port(), &certificate());
    let report = test(&emulator, PROBE_DEADLINE, now()).await;
    assert_eq!(
        outcomes(&report),
        failed_at(Step::Connection, Reason::ConnectionRefused)
    );
}

#[tokio::test(start_paused = true)]
async fn test_with_a_certificate_from_another_ca_fails_at_tls_untrusted() {
    let (trusted, presented) = (certificate(), certificate());
    let server = StandIn::new(&presented, ALL_OK);
    let (_home, emulator) = home_for(PORT, &trusted);
    let report = test_over(&emulator, PROBE_DEADLINE, now(), server.dial()).await;
    assert_eq!(
        outcomes(&report),
        failed_at(Step::Tls, Reason::TlsUntrusted)
    );
    assert!(server.received().is_empty());
}

#[tokio::test(start_paused = true)]
async fn test_with_health_answering_503_fails_at_health_unexpected_response() {
    let (report, _, _) = run_against(Answers {
        health: Some(UNAVAILABLE),
        sts: Some(STS_OK),
    })
    .await;
    assert_eq!(
        outcomes(&report),
        failed_at(Step::Health, Reason::UnexpectedResponse { status: 503 })
    );
}

#[tokio::test(start_paused = true)]
async fn test_with_the_sts_request_refused_fails_at_credentials() {
    let cases = [
        (
            "403",
            FORBIDDEN,
            Reason::CredentialsRejected,
            "credentials_rejected",
        ),
        (
            "500",
            SERVER_ERROR,
            Reason::UnexpectedResponse { status: 500 },
            "unexpected_response",
        ),
    ];
    for (name, answer, reason, code) in cases {
        let (report, _, _) = run_against(Answers {
            health: Some(OK),
            sts: Some(answer),
        })
        .await;
        assert_eq!(
            outcomes(&report),
            failed_at(Step::Credentials, reason),
            "case {name}"
        );
        assert_eq!(
            report.checks[4].1.reason().unwrap().code(),
            code,
            "case {name}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn test_with_a_server_that_never_answers_times_out_at_the_deadline() {
    let cases = [
        (
            "health never answered",
            Answers {
                health: None,
                sts: Some(STS_OK),
            },
            Step::Health,
        ),
        (
            "sts never answered",
            Answers {
                health: Some(OK),
                sts: None,
            },
            Step::Credentials,
        ),
    ];
    for (name, answers, step) in cases {
        let ca = certificate();
        let server = StandIn::new(&ca, answers);
        let (_home, emulator) = home_for(PORT, &ca);
        let start = tokio::time::Instant::now();
        let report = test_over(&emulator, PROBE_DEADLINE, now(), server.dial()).await;
        assert_eq!(
            outcomes(&report),
            failed_at(step, Reason::Timeout),
            "case {name}"
        );
        assert_eq!(start.elapsed(), PROBE_DEADLINE, "case {name}");
    }
}

#[tokio::test(start_paused = true)]
async fn test_answered_by_a_redirect_is_unexpected_response_and_sends_no_second_request() {
    const REDIRECT: &[u8] =
        b"HTTP/1.1 302 Found\r\nlocation: https://127.0.0.1:1/elsewhere\r\ncontent-length: 0\r\n\r\n";
    let cases = [
        (
            "health redirected",
            Answers {
                health: Some(REDIRECT),
                sts: Some(STS_OK),
            },
            Step::Health,
            1,
            1,
        ),
        (
            "sts redirected",
            Answers {
                health: Some(OK),
                sts: Some(REDIRECT),
            },
            Step::Credentials,
            2,
            2,
        ),
    ];
    for (name, answers, step, requests, connections) in cases {
        let (report, received, opened) = run_against(answers).await;
        assert_eq!(
            outcomes(&report),
            failed_at(step, Reason::UnexpectedResponse { status: 302 }),
            "case {name}"
        );
        assert_eq!(received.len(), requests, "case {name}: {received:?}");
        assert_eq!(opened, connections, "case {name}");
        assert!(
            received
                .iter()
                .all(|request| !request.request_line().contains("/elsewhere")),
            "case {name}: {received:?}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn credentials_step_sends_post_root_with_the_sts_body_host_and_date() {
    let (report, received, _) = run_against(ALL_OK).await;
    assert!(report.passed(), "{report:?}");
    assert_eq!(received.len(), 2, "{received:?}");
    let sts = &received[1];
    assert_eq!(sts.request_line(), "POST / HTTP/1.1");
    assert_eq!(sts.body, CREDENTIALS_BODY.as_bytes());
    assert_eq!(sts.body, b"Action=GetCallerIdentity&Version=2011-06-15");
    assert_eq!(sts.header("host").as_deref(), Some("127.0.0.1:9391"));
    assert_eq!(
        sts.header("x-amz-date").as_deref(),
        Some("20261119T120000Z")
    );
    assert_eq!(
        sts.header("content-type").as_deref(),
        Some("application/x-www-form-urlencoded; charset=utf-8")
    );
}

// ---------------------------------------------------------------------------------------------- vector

/// Sections of a vector file: `== name ==` lines, each followed by its text verbatim.
fn sections(file: &str) -> HashMap<String, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/vectors")
        .join(file);
    let text = fs::read_to_string(path).unwrap();
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

#[tokio::test]
async fn credentials_request_signed_with_a_fixed_key_and_time_equals_the_botocore_vector() {
    let vector = sections("sts-get-caller-identity.txt");
    let host: SocketAddr = vector["host"].parse().unwrap();
    let now = UNIX_EPOCH + Duration::from_secs(vector["now-unix-seconds"].parse().unwrap());
    let home = tempfile::tempdir().unwrap();
    let emulator = Emulator::new(home.path(), NonZeroU16::new(host.port()).unwrap());
    write_files(&emulator, &certificate().pem);
    let files = EmulatorFiles::read(&emulator).await.unwrap();

    let request = credentials_request(&emulator, files.credentials(), now).unwrap();
    let header = |name: &str| request.headers()[name].to_str().unwrap().to_owned();
    assert_eq!(request.method(), "POST");
    assert_eq!(request.uri(), "/");
    assert_eq!(header("host"), vector["host"]);
    assert_eq!(header("content-type"), vector["content-type"]);
    assert_eq!(header("x-amz-date"), vector["x-amz-date"]);
    assert_eq!(header("authorization"), vector["authorization"]);
    let body = request.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), vector["body"].as_bytes());
}

// ---------------------------------------------------------------------------------------------- redaction

fn every_reason() -> Vec<Reason> {
    vec![
        Reason::NotStarted,
        Reason::FilesUnreadable {
            file: CREDENTIALS_FILE,
        },
        Reason::ConnectionRefused,
        Reason::TlsUntrusted,
        Reason::Timeout,
        Reason::UnexpectedResponse { status: 403 },
        Reason::CredentialsRejected,
        Reason::ConnectionFailed {
            kind: "connection reset".to_owned(),
        },
    ]
}

#[tokio::test(start_paused = true)]
async fn test_report_and_every_reason_hold_no_key_when_formatted() {
    let mut reports = vec![run_against(ALL_OK).await.0];
    for answers in [
        Answers {
            health: Some(OK),
            sts: Some(FORBIDDEN),
        },
        Answers {
            health: Some(UNAVAILABLE),
            sts: Some(STS_OK),
        },
    ] {
        reports.push(run_against(answers).await.0);
    }
    for reason in every_reason() {
        reports.push(TestReport {
            checks: vec![(Step::Credentials, Outcome::Failed(reason))],
        });
    }
    let mut texts = Vec::new();
    for report in &reports {
        texts.push(format!("{report:?}"));
        texts.push(format!("{report}"));
        for (step, outcome) in &report.checks {
            texts.push(format!("{step:?} {step} {outcome:?} {outcome}"));
        }
    }
    let emulator = Emulator::new(Path::new("/h"), NonZeroU16::new(9391).unwrap());
    for reason in every_reason() {
        texts.push(format!("{reason:?}"));
        texts.push(format!("{reason}"));
        texts.push(reason.message(&emulator));
    }
    for text in texts {
        assert!(!text.contains(KEY_ID), "{text}");
        assert!(!text.contains(SECRET), "{text}");
    }
}

#[test]
fn reason_credentials_rejected_has_its_code_and_names_the_credentials_file() {
    let emulator = Emulator::new(Path::new("/h"), NonZeroU16::new(9391).unwrap());
    let reason = Reason::CredentialsRejected;
    assert_eq!(reason.code(), "credentials_rejected");
    assert_eq!(reason.to_string(), "credentials_rejected");
    let message = reason.message(&emulator);
    assert!(message.contains("https://127.0.0.1:9391"), "{message}");
    assert!(message.contains(CREDENTIALS_FILE), "{message}");
}
