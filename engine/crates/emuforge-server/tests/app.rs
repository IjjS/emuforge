#![cfg(test)]

use std::io;
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use std::sync::Mutex;

use axum::Router;
use axum::body::Body;
use axum::http::header::{ALLOW, CONNECTION, CONTENT_TYPE, HOST, ORIGIN};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use emuforge_core::{
    Emulator, Health, Limits, Prepared, Reason, RelayError, SETTINGS_FILE, Store, forward,
};
use emuforge_server::{
    AppState, CLIENT_WRITE_IDLE, DRAIN_BOUND, Form, IdleListener, ProbeFn, RelayFn, SessionToken,
    StudioOrigin, app, seed_settings,
};
use hyper::body::{Bytes, Frame};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::{Notify, mpsc, oneshot};
use tower::ServiceExt;

const ENGINE_HOST: &str = "127.0.0.1:8297";
const HEALTH: &str = "/__emuforge/health";

fn emulator() -> Emulator {
    Emulator::new(Path::new("/h"), NonZeroU16::new(9391).unwrap())
}

/// A store whose folder does not exist: every load is the seed, `local` at `https://127.0.0.1:9391`.
fn absent_settings() -> Arc<Store> {
    Arc::new(Store::new(
        PathBuf::from("/h/.config/emuforge"),
        seed_settings(Form::Native, NonZeroU16::new(9391).unwrap()),
    ))
}

fn app_with(probe: ProbeFn) -> Router {
    app_relaying(probe, TestRelay::answering(Script::ok()).relay)
}

fn app_relaying(probe: ProbeFn, relay: RelayFn) -> Router {
    app(AppState {
        engine_port: NonZeroU16::new(8297).unwrap(),
        studio_port: NonZeroU16::new(8296).unwrap(),
        form: Form::Native,
        home: PathBuf::from("/h"),
        settings: absent_settings(),
        probe,
        relay,
        test: Arc::new(|_| Box::pin(async { emuforge_core::TestReport { checks: Vec::new() } })),
        max_in_flight: 2,
        studio_origin: StudioOrigin::new(NonZeroU16::new(8296).unwrap()),
        session: Arc::new(SessionToken::generate().unwrap()),
    })
}

/// A probe that answers `healths` in order, repeating the last, and counts its calls.
fn answering(healths: Vec<Health>) -> (ProbeFn, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let probe: ProbeFn = Arc::new(move |_emulator| {
        let call = counter.fetch_add(1, Ordering::SeqCst);
        let health = healths[call.min(healths.len() - 1)].clone();
        Box::pin(async move { health })
    });
    (probe, calls)
}

fn request(method: Method, path: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, ENGINE_HOST)
}

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    fn code(&self) -> String {
        self.json()["error"]["code"].as_str().unwrap().to_owned()
    }
}

async fn send(app: &Router, request: Request<Body>) -> Answer {
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    for name in parts.headers.keys() {
        assert!(
            !name.as_str().starts_with("access-control-"),
            "CORS header {name} on {}",
            parts.status
        );
    }
    let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    Answer {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}

async fn get(app: &Router, path: &str) -> Answer {
    send(app, request(Method::GET, path).body(Body::empty()).unwrap()).await
}

fn every_reason() -> Vec<Reason> {
    vec![
        Reason::NotStarted,
        Reason::FilesUnreadable { file: "ca.pem" },
        Reason::ConnectionRefused,
        Reason::TlsUntrusted,
        Reason::Timeout,
        Reason::UnexpectedResponse { status: 500 },
        Reason::ConnectionFailed {
            kind: "connection reset".to_owned(),
        },
    ]
}

#[tokio::test]
async fn health_reachable_is_200_with_emulator_and_no_reason() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let answer = get(&app_with(probe), HEALTH).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.headers[CONTENT_TYPE], "application/json");
    assert_eq!(
        answer.body,
        r#"{"target":"local","emulator":{"port":9391,"endpoint":"https://127.0.0.1:9391","reachable":true}}"#
    );
}

#[tokio::test]
async fn health_unreachable_is_503_with_reason_code_and_message() {
    for reason in every_reason() {
        let (probe, _) = answering(vec![Health::Unreachable(reason.clone())]);
        let answer = get(&app_with(probe), HEALTH).await;
        let code = reason.code();
        assert_eq!(
            answer.status,
            StatusCode::SERVICE_UNAVAILABLE,
            "case {code}"
        );
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {code}"
        );
        assert_eq!(
            answer.json(),
            json!({"target": "local", "emulator": {
                "port": 9391,
                "endpoint": "https://127.0.0.1:9391",
                "reachable": false,
                "reason": code,
                "message": reason.message(&emulator()),
            }}),
            "case {code}"
        );
    }
}

#[tokio::test]
async fn health_head_has_status_and_content_type_without_body() {
    let (probe, _) = answering(vec![
        Health::Reachable,
        Health::Unreachable(Reason::NotStarted),
    ]);
    let app = app_with(probe);
    for expected in [StatusCode::OK, StatusCode::SERVICE_UNAVAILABLE] {
        let answer = send(
            &app,
            request(Method::HEAD, HEALTH).body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(answer.status, expected);
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {expected}"
        );
        assert!(answer.body.is_empty(), "case {expected}");
    }
}

#[tokio::test]
async fn health_twice_probes_twice_without_caching() {
    let (probe, calls) = answering(vec![
        Health::Unreachable(Reason::NotStarted),
        Health::Reachable,
    ]);
    let app = app_with(probe);
    assert_eq!(
        get(&app, HEALTH).await.status,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(get(&app, HEALTH).await.status, StatusCode::OK);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn health_other_method_is_405_allowing_get_and_head_without_probe() {
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::PATCH,
        Method::OPTIONS,
    ] {
        let (probe, calls) = answering(vec![Health::Reachable]);
        let answer = send(
            &app_with(probe),
            request(method.clone(), HEALTH).body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(
            answer.status,
            StatusCode::METHOD_NOT_ALLOWED,
            "case {method}"
        );
        let allow = answer.headers.get_all(ALLOW).iter().collect::<Vec<_>>();
        assert_eq!(allow, ["GET, HEAD"], "case {method}");
        assert_eq!(answer.code(), "MethodNotAllowed", "case {method}");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "case {method}");
    }
}

#[tokio::test]
async fn other_path_is_404_not_found() {
    for path in ["/__emuforge/other", "/__emuforge", "/__emuforge/health/x"] {
        let (probe, calls) = answering(vec![Health::Reachable]);
        let answer = get(&app_with(probe), path).await;
        assert_eq!(answer.status, StatusCode::NOT_FOUND, "case {path}");
        assert_eq!(answer.code(), "NotFound", "case {path}");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "case {path}");
    }
}

#[tokio::test]
async fn health_with_foreign_host_is_421_without_probe() {
    let cases = [
        ("absent", None),
        ("localhost", Some("localhost:8297")),
        ("other port", Some("127.0.0.1:8298")),
        ("no port", Some("127.0.0.1")),
        ("foreign name", Some("example.com:8297")),
    ];
    for (name, host) in cases {
        let (probe, calls) = answering(vec![Health::Reachable]);
        let mut builder = Request::builder().uri(HEALTH);
        if let Some(host) = host {
            builder = builder.header(HOST, host);
        }
        let answer = send(&app_with(probe), builder.body(Body::empty()).unwrap()).await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {name}"
        );
        assert_eq!(answer.code(), "MisdirectedRequest", "case {name}");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "case {name}");
    }
}

#[tokio::test]
async fn health_with_origin_is_403_without_probe() {
    for origin in ["http://127.0.0.1:8100", "https://example.com", "null"] {
        let (probe, calls) = answering(vec![Health::Reachable]);
        let answer = send(
            &app_with(probe),
            request(Method::GET, HEALTH)
                .header(ORIGIN, origin)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "case {origin}");
        assert_eq!(answer.code(), "OriginNotAllowed", "case {origin}");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "case {origin}");
    }
}

#[tokio::test]
async fn guards_apply_in_order_host_origin_path_method() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let app = app_with(probe);
    let foreign_host_and_origin = Request::get(HEALTH)
        .header(HOST, "example.com:8297")
        .header(ORIGIN, "https://example.com")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        send(&app, foreign_host_and_origin).await.status,
        StatusCode::MISDIRECTED_REQUEST
    );
    let other_with_origin = request(Method::GET, "/__emuforge/other")
        .header(ORIGIN, "https://example.com")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        send(&app, other_with_origin).await.status,
        StatusCode::FORBIDDEN
    );
    let post_other = request(Method::POST, "/__emuforge/other")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&app, post_other).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn refusals_are_json_error_bodies() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let app = app_with(probe);
    let cases = [
        (
            "GET /__emuforge/other",
            request(Method::GET, "/__emuforge/other")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "POST health",
            request(Method::POST, HEALTH).body(Body::empty()).unwrap(),
        ),
        (
            "foreign Host",
            Request::get(HEALTH)
                .header(HOST, "example.com:8297")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "Origin",
            request(Method::GET, HEALTH)
                .header(ORIGIN, "https://example.com")
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (name, request) in cases {
        let answer = send(&app, request).await;
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {name}"
        );
        let body = answer.json();
        let error = body["error"].as_object().unwrap();
        assert_eq!(body.as_object().unwrap().len(), 1, "case {name}: {body}");
        assert_eq!(error.len(), 2, "case {name}: {body}");
        assert!(
            error["code"].is_string() && error["message"].is_string(),
            "case {name}: {body}"
        );
    }
}

/// A request body that records being polled and then fails.
struct Tripwire(Arc<AtomicBool>);

impl hyper::body::Body for Tripwire {
    type Data = Bytes;
    type Error = io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        self.0.store(true, Ordering::SeqCst);
        Poll::Ready(Some(Err(io::Error::other("the request body was read"))))
    }
}

#[tokio::test]
async fn request_body_is_never_read() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let app = app_with(probe);
    for (method, expected) in [
        (Method::GET, StatusCode::OK),
        (Method::POST, StatusCode::METHOD_NOT_ALLOWED),
    ] {
        let polled = Arc::new(AtomicBool::new(false));
        let body = Body::new(Tripwire(polled.clone()));
        let answer = send(&app, request(method.clone(), HEALTH).body(body).unwrap()).await;
        assert_eq!(answer.status, expected, "case {method}");
        assert!(!polled.load(Ordering::SeqCst), "case {method}: body polled");
    }
}

/// Counts probe futures dropped before they finished.
struct DropGuard {
    dropped: Arc<AtomicUsize>,
    finished: bool,
}

impl Drop for DropGuard {
    fn drop(&mut self) {
        if !self.finished {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// A probe whose first `held` calls wait on `release`; later calls answer at once. Every call is `Reachable`.
struct Held {
    probe: ProbeFn,
    release: Arc<Notify>,
    entered: mpsc::UnboundedReceiver<()>,
    calls: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}

impl Held {
    fn new(held: usize) -> Held {
        let release = Arc::new(Notify::new());
        let (entered_tx, entered) = mpsc::unbounded_channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let (notify, counter, drops) = (release.clone(), calls.clone(), dropped.clone());
        let probe: ProbeFn = Arc::new(move |_emulator| {
            let call = counter.fetch_add(1, Ordering::SeqCst);
            let (notify, entered, dropped) = (notify.clone(), entered_tx.clone(), drops.clone());
            Box::pin(async move {
                if call < held {
                    let mut guard = DropGuard {
                        dropped,
                        finished: false,
                    };
                    let released = notify.notified();
                    tokio::pin!(released);
                    released.as_mut().enable();
                    let _ = entered.send(());
                    released.await;
                    guard.finished = true;
                }
                Health::Reachable
            })
        });
        Held {
            probe,
            release,
            entered,
            calls,
            dropped,
        }
    }

    async fn wait_entered(&mut self, count: usize) {
        for _ in 0..count {
            self.entered.recv().await.unwrap();
        }
    }
}

fn spawn_get(app: &Router, request: Request<Body>) -> tokio::task::JoinHandle<StatusCode> {
    let app = app.clone();
    tokio::spawn(async move { app.oneshot(request).await.unwrap().status() })
}

fn health_request() -> Request<Body> {
    request(Method::GET, HEALTH).body(Body::empty()).unwrap()
}

/// Sends one request that must answer without waiting on anything held.
async fn send_at_once(app: &Router, request: Request<Body>) -> Answer {
    tokio::time::timeout(Duration::from_secs(1), send(app, request))
        .await
        .expect("the request waited instead of answering at once")
}

#[tokio::test(start_paused = true)]
async fn health_at_the_limit_answers_every_request_once_released() {
    let mut held = Held::new(2);
    let app = app_with(held.probe.clone());
    let first = spawn_get(&app, health_request());
    let second = spawn_get(&app, health_request());
    held.wait_entered(2).await;
    held.release.notify_waiters();
    assert_eq!(first.await.unwrap(), StatusCode::OK);
    assert_eq!(second.await.unwrap(), StatusCode::OK);
}

#[tokio::test(start_paused = true)]
async fn health_one_past_the_limit_is_busy_at_once_without_probe() {
    let mut held = Held::new(2);
    let app = app_with(held.probe.clone());
    let _first = spawn_get(&app, health_request());
    let _second = spawn_get(&app, health_request());
    held.wait_entered(2).await;
    let answer = send_at_once(&app, health_request()).await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(answer.code(), "Busy");
    assert_eq!(held.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn limit_is_shared_by_every_route_and_refusal() {
    let mut held = Held::new(2);
    let app = app_with(held.probe.clone());
    let _first = spawn_get(&app, health_request());
    let _second = spawn_get(&app, health_request());
    held.wait_entered(2).await;
    let cases = [
        (
            "GET /__emuforge/other",
            request(Method::GET, "/__emuforge/other")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "foreign Host",
            Request::get(HEALTH)
                .header(HOST, "example.com")
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (name, request) in cases {
        let answer = send_at_once(&app, request).await;
        assert_eq!(
            answer.status,
            StatusCode::SERVICE_UNAVAILABLE,
            "case {name}"
        );
        assert_eq!(answer.code(), "Busy", "case {name}");
    }
}

#[tokio::test(start_paused = true)]
async fn health_after_held_requests_complete_is_served() {
    let mut held = Held::new(2);
    let app = app_with(held.probe.clone());
    let first = spawn_get(&app, health_request());
    let second = spawn_get(&app, health_request());
    held.wait_entered(2).await;
    held.release.notify_waiters();
    first.await.unwrap();
    second.await.unwrap();
    assert_eq!(
        send_at_once(&app, health_request()).await.status,
        StatusCode::OK
    );
}

#[tokio::test(start_paused = true)]
async fn dropped_request_drops_its_probe_and_frees_its_place() {
    let mut held = Held::new(2);
    let app = app_with(held.probe.clone());
    let _first = spawn_get(&app, health_request());
    let mut second = Box::pin(app.clone().oneshot(health_request()));
    let pending = tokio::time::timeout(Duration::from_millis(1), &mut second).await;
    assert!(pending.is_err(), "the held request answered");
    held.wait_entered(2).await;
    drop(second);
    assert_eq!(held.dropped.load(Ordering::SeqCst), 1);
    assert_eq!(
        send_at_once(&app, health_request()).await.status,
        StatusCode::OK
    );
}

// ---- Relayed paths (issue 2) ----

const SIGNATURE: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const CLIENT_KEY: &str = "AKIACLIENTKEY0000001";
const AMZ_DATE: &str = "20261115T000000Z";
const FORM: &str = "application/x-www-form-urlencoded; charset=utf-8";

/// What the stand-in emulator behind the test relay does, or the error the test relay returns.
#[derive(Clone)]
enum Script {
    /// One answer with `Content-Length` (no body for `HEAD`).
    Fixed {
        status: u16,
        headers: Vec<(&'static str, &'static str)>,
        body: &'static [u8],
    },
    /// A chunked answer whose head and first chunk are sent at once; the stand-in sends its release sender
    /// before the head, and ends the body when it is released.
    Held {
        releases: mpsc::UnboundedSender<oneshot::Sender<()>>,
    },
    /// `size` bytes with `Content-Length`, written as fast as the engine reads; reports the (paused) clock's
    /// time when the engine side of the connection is gone.
    Large {
        size: usize,
        closed: mpsc::UnboundedSender<tokio::time::Instant>,
    },
    /// One answer with `Content-Length`, sent after the head and before any body byte is read; the stand-in then
    /// holds the connection without reading, so the upload cannot end before the answer arrives.
    Early {
        status: u16,
        body: &'static [u8],
    },
    Error(RelayError),
}

impl Script {
    fn ok() -> Script {
        Script::Fixed {
            status: 200,
            headers: vec![
                ("content-type", "application/xml"),
                ("x-amz-request-id", "test-request-1"),
            ],
            body: b"<ListAllMyBucketsResult/>",
        }
    }
}

/// A relay seam that records each request it is called with (method and target) and answers by `script`,
/// through `emuforge_core::forward` over a duplex stream to a scripted stand-in.
struct TestRelay {
    relay: RelayFn,
    seen: Arc<Mutex<Vec<(Method, String)>>>,
}

impl TestRelay {
    fn answering(script: Script) -> TestRelay {
        TestRelay::with_limits(script, Limits::DEFAULT)
    }

    fn with_limits(script: Script, limits: Limits) -> TestRelay {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let relay: RelayFn = Arc::new(move |_emulator, request: Request<Body>| {
            record
                .lock()
                .unwrap()
                .push((request.method().clone(), request.uri().to_string()));
            let script = script.clone();
            Box::pin(async move {
                if let Script::Error(error) = script {
                    return Err(error);
                }
                let (engine, emulator) = tokio::io::duplex(64 * 1024);
                let head_only = request.method() == Method::HEAD;
                tokio::spawn(stand_in(emulator, script, head_only));
                let (parts, body) = request.into_parts();
                forward(
                    engine,
                    Arc::new(AtomicBool::new(false)),
                    Prepared { head: parts },
                    body,
                    &limits,
                )
                .await
            })
        });
        TestRelay { relay, seen }
    }

    fn seen(&self) -> Vec<(Method, String)> {
        self.seen.lock().unwrap().clone()
    }
}

async fn stand_in(mut stream: DuplexStream, script: Script, head_only: bool) {
    let mut head = Vec::new();
    let mut byte = [0; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).await.unwrap_or(0) == 0 {
            return;
        }
        head.push(byte[0]);
    }
    match script {
        Script::Fixed {
            status,
            headers,
            body,
        } => {
            let mut answer = format!("HTTP/1.1 {status} X\r\n");
            for (name, value) in headers {
                answer.push_str(&format!("{name}: {value}\r\n"));
            }
            answer.push_str(&format!("content-length: {}\r\n\r\n", body.len()));
            let mut bytes = answer.into_bytes();
            if !head_only {
                bytes.extend_from_slice(body);
            }
            let _ = stream.write_all(&bytes).await;
        }
        Script::Held { releases } => {
            let (release, released) = oneshot::channel();
            let _ = releases.send(release);
            let head = "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nfirst\r\n";
            if stream.write_all(head.as_bytes()).await.is_err() {
                return;
            }
            if released.await.is_ok() {
                let _ = stream.write_all(b"0\r\n\r\n").await;
            }
            // Keep the connection until the engine closes it.
            let _ = stream.read(&mut byte).await;
        }
        Script::Large { size, closed } => {
            let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {size}\r\n\r\n");
            let mut failed = stream.write_all(head.as_bytes()).await.is_err();
            let chunk = vec![b'x'; 16 * 1024];
            let mut sent = 0;
            while !failed && sent < size {
                let n = chunk.len().min(size - sent);
                failed = stream.write_all(&chunk[..n]).await.is_err();
                sent += n;
            }
            if !failed {
                // Everything written: wait for the engine to close its side.
                let _ = stream.read(&mut byte).await;
            }
            let _ = closed.send(tokio::time::Instant::now());
        }
        Script::Early { status, body } => {
            let head = format!(
                "HTTP/1.1 {status} X\r\ncontent-length: {}\r\n\r\n",
                body.len()
            );
            if stream.write_all(head.as_bytes()).await.is_err()
                || stream.write_all(body).await.is_err()
            {
                return;
            }
            std::future::pending::<()>().await;
        }
        Script::Error(_) => {}
    }
}

impl Answer {
    /// The code of an error in the JSON or REST-JSON protocol shape: `x-amzn-ErrorType`, equal to `__type`.
    fn aws_code(&self) -> String {
        let header = self.headers["x-amzn-errortype"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            self.json()["__type"],
            header.as_str(),
            "__type and x-amzn-ErrorType"
        );
        header
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.to_vec()).unwrap()
    }
}

fn reachable_probe() -> ProbeFn {
    answering(vec![Health::Reachable]).0
}

fn header_signed(method: Method, path: &str, service: &str) -> axum::http::request::Builder {
    request(method, path)
        .header(
            "authorization",
            format!(
                "AWS4-HMAC-SHA256 Credential={CLIENT_KEY}/20261115/us-east-1/{service}/aws4_request, SignedHeaders=host;x-amz-date, Signature={SIGNATURE}"
            ),
        )
        .header("x-amz-date", AMZ_DATE)
}

fn empty(builder: axum::http::request::Builder) -> Request<Body> {
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn relayed_methods_pass_the_relay_answer_and_call_it_once() {
    let cases = [
        (Method::GET, "/"),
        (Method::POST, "/"),
        (Method::PUT, "/b/k"),
        (Method::DELETE, "/b/k"),
        (Method::PATCH, "/x"),
        (Method::HEAD, "/b/k"),
        (Method::OPTIONS, "/x"),
        (Method::GET, "/2015-03-31/functions/"),
        (Method::GET, "/b?list-type=2&max-keys=1"),
    ];
    for (method, path) in cases {
        let case = format!("{method} {path}");
        let relay = TestRelay::answering(Script::ok());
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        let answer = send(&app, empty(request(method.clone(), path))).await;
        assert_eq!(answer.status, StatusCode::OK, "case {case}");
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/xml",
            "case {case}"
        );
        assert_eq!(
            answer.headers["x-amz-request-id"], "test-request-1",
            "case {case}"
        );
        let expected: &[u8] = if method == Method::HEAD {
            b""
        } else {
            b"<ListAllMyBucketsResult/>"
        };
        assert_eq!(answer.body, expected, "case {case}");
        assert_eq!(relay.seen(), [(method, path.to_owned())], "case {case}");
    }
}

#[tokio::test]
async fn emulator_admin_path_is_relayed() {
    let relay = TestRelay::answering(Script::ok());
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let answer = get(&app, "/__admin/health").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(relay.seen(), [(Method::GET, "/__admin/health".to_owned())]);
}

#[tokio::test]
async fn engine_paths_without_a_route_are_404_and_not_relayed() {
    let cases = [
        (Method::GET, "/__emuforge"),
        (Method::GET, "/__emuforge/other"),
        (Method::POST, "/__emuforge/other"),
        (Method::GET, "/__emuforge/health/x"),
    ];
    for (method, path) in cases {
        let case = format!("{method} {path}");
        let relay = TestRelay::answering(Script::ok());
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        let answer = send(&app, empty(request(method, path))).await;
        assert_eq!(answer.status, StatusCode::NOT_FOUND, "case {case}");
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {case}"
        );
        assert_eq!(answer.code(), "NotFound", "case {case}");
        assert!(relay.seen().is_empty(), "case {case}: relayed");
    }
}

#[tokio::test]
async fn relayed_path_with_origin_is_403_in_the_callers_protocol_and_not_relayed() {
    for origin in ["http://127.0.0.1:8100", "https://example.com", "null"] {
        let relay = TestRelay::answering(Script::ok());
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        let answer = send(
            &app,
            empty(request(Method::GET, "/b/k").header(ORIGIN, origin)),
        )
        .await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "case {origin}");
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {origin}"
        );
        assert_eq!(answer.aws_code(), "OriginNotAllowed", "case {origin}");
        assert!(relay.seen().is_empty(), "case {origin}: relayed");
    }
}

#[tokio::test]
async fn relayed_path_with_foreign_host_is_421_in_the_callers_protocol_and_not_relayed() {
    let cases = [
        ("absent", None),
        ("localhost", Some("localhost:8297")),
        ("other port", Some("127.0.0.1:8298")),
        ("foreign name", Some("example.com:8297")),
        ("virtual-hosted bucket", Some("bucket.127.0.0.1:8297")),
    ];
    for (name, host) in cases {
        let relay = TestRelay::answering(Script::ok());
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        let mut builder = Request::builder().method(Method::GET).uri("/b/k");
        if let Some(host) = host {
            builder = builder.header(HOST, host);
        }
        let answer = send(&app, empty(builder)).await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {name}"
        );
        assert_eq!(answer.aws_code(), "MisdirectedRequest", "case {name}");
        assert!(relay.seen().is_empty(), "case {name}: relayed");
    }
}

#[tokio::test]
async fn s3_request_with_foreign_host_and_origin_is_421_in_s3_xml() {
    let relay = TestRelay::answering(Script::ok());
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let answer = send(
        &app,
        empty(
            header_signed(Method::GET, "/b/k", "s3")
                .header(HOST, "example.com:8297")
                .header(ORIGIN, "https://example.com"),
        ),
    )
    .await;
    assert_eq!(answer.status, StatusCode::MISDIRECTED_REQUEST);
    assert_eq!(answer.headers[CONTENT_TYPE], "application/xml");
    let body = answer.text();
    assert!(
        body.starts_with("<Error><Code>MisdirectedRequest</Code><Message>"),
        "{body}"
    );
    assert!(relay.seen().is_empty(), "relayed");
}

#[tokio::test]
async fn absolute_form_target_and_connect_are_421_and_not_relayed() {
    let cases = [
        (
            "absolute-form",
            Request::builder()
                .method(Method::GET)
                .uri("http://s3.amazonaws.com/")
                .header(HOST, ENGINE_HOST),
        ),
        (
            "CONNECT",
            Request::builder()
                .method(Method::CONNECT)
                .uri("s3.amazonaws.com:443")
                .header(HOST, ENGINE_HOST),
        ),
    ];
    for (name, builder) in cases {
        let relay = TestRelay::answering(Script::ok());
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        let answer = send(&app, empty(builder)).await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {name}"
        );
        assert_eq!(answer.aws_code(), "MisdirectedRequest", "case {name}");
        assert!(relay.seen().is_empty(), "case {name}: relayed");
    }
}

#[tokio::test]
async fn origin_refusal_takes_each_protocols_shape() {
    let relay = TestRelay::answering(Script::ok());
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let origin = "https://example.com";

    let dynamodb = send(
        &app,
        empty(
            header_signed(Method::POST, "/", "dynamodb")
                .header("x-amz-target", "DynamoDB_20120810.ListTables")
                .header(CONTENT_TYPE, "application/x-amz-json-1.0")
                .header(ORIGIN, origin),
        ),
    )
    .await;
    assert_eq!(dynamodb.status, StatusCode::FORBIDDEN, "case dynamodb");
    assert_eq!(
        dynamodb.headers[CONTENT_TYPE], "application/x-amz-json-1.0",
        "case dynamodb"
    );
    assert_eq!(dynamodb.aws_code(), "OriginNotAllowed", "case dynamodb");

    let s3 = send(
        &app,
        empty(header_signed(Method::GET, "/b/k", "s3").header(ORIGIN, origin)),
    )
    .await;
    assert_eq!(s3.status, StatusCode::FORBIDDEN, "case s3");
    assert_eq!(s3.headers[CONTENT_TYPE], "application/xml", "case s3");
    assert!(
        s3.text()
            .starts_with("<Error><Code>OriginNotAllowed</Code><Message>"),
        "case s3: {}",
        s3.text()
    );

    let iam = send(
        &app,
        empty(
            header_signed(Method::POST, "/", "iam")
                .header(CONTENT_TYPE, FORM)
                .header(ORIGIN, origin),
        ),
    )
    .await;
    assert_eq!(iam.status, StatusCode::FORBIDDEN, "case iam");
    assert_eq!(iam.headers[CONTENT_TYPE], "text/xml", "case iam");
    assert!(
        iam.text().starts_with(
            "<?xml version=\"1.0\"?><ErrorResponse><Error><Type>Sender</Type><Code>OriginNotAllowed</Code><Message>"
        ),
        "case iam: {}",
        iam.text()
    );

    let lambda = send(
        &app,
        empty(
            header_signed(Method::GET, "/2015-03-31/functions/", "lambda").header(ORIGIN, origin),
        ),
    )
    .await;
    assert_eq!(lambda.status, StatusCode::FORBIDDEN, "case lambda");
    assert_eq!(
        lambda.headers[CONTENT_TYPE], "application/json",
        "case lambda"
    );
    assert_eq!(lambda.aws_code(), "OriginNotAllowed", "case lambda");

    assert!(relay.seen().is_empty(), "relayed");
}

/// `(<Type>, <Code>, <Message>)` of a query-protocol error body.
fn query_error(body: &str) -> (String, String, String) {
    let element = |name: &str| {
        let open = format!("<{name}>");
        let close = format!("</{name}>");
        let start = body.find(&open).unwrap() + open.len();
        let end = body[start..].find(&close).unwrap() + start;
        body[start..end].to_owned()
    };
    (element("Type"), element("Code"), element("Message"))
}

/// An IAM form `POST`, answered in the query protocol, whose relay returns `error`.
async fn relay_failing(error: RelayError) -> Answer {
    let relay = TestRelay::answering(Script::Error(error));
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let answer = send(
        &app,
        empty(header_signed(Method::POST, "/", "iam").header(CONTENT_TYPE, FORM)),
    )
    .await;
    assert_eq!(relay.seen().len(), 1, "the relay was not called once");
    answer
}

#[tokio::test]
async fn relay_errors_are_the_engines_answers_in_the_callers_protocol() {
    let mut cases = vec![
        (
            "ClientStalled",
            RelayError::ClientStalled,
            StatusCode::REQUEST_TIMEOUT,
            "RequestTimeout",
            "Sender",
        ),
        (
            "EmulatorStalled",
            RelayError::EmulatorStalled,
            StatusCode::GATEWAY_TIMEOUT,
            "EmulatorTimeout",
            "Receiver",
        ),
        (
            "HeadTimeout",
            RelayError::HeadTimeout,
            StatusCode::GATEWAY_TIMEOUT,
            "EmulatorTimeout",
            "Receiver",
        ),
        (
            "ClientBodyFailed",
            RelayError::ClientBodyFailed,
            StatusCode::BAD_REQUEST,
            "IncompleteBody",
            "Sender",
        ),
    ];
    for reason in every_reason() {
        cases.push((
            reason.code(),
            RelayError::Unavailable(reason),
            StatusCode::SERVICE_UNAVAILABLE,
            "EmulatorUnavailable",
            "Receiver",
        ));
    }
    for (name, error, status, code, kind) in cases {
        let unavailable = matches!(error, RelayError::Unavailable(_));
        let answer = relay_failing(error).await;
        assert_eq!(answer.status, status, "case {name}");
        assert_eq!(answer.headers[CONTENT_TYPE], "text/xml", "case {name}");
        let (error_type, error_code, message) = query_error(&answer.text());
        assert_eq!(error_type, kind, "case {name}");
        assert_eq!(error_code, code, "case {name}");
        if unavailable {
            assert!(
                message.contains("https://127.0.0.1:9391")
                    && message.contains(&format!("({name})")),
                "case {name}: {message}"
            );
        }
    }
}

#[tokio::test]
async fn relay_errors_before_the_head_close_the_client_connection() {
    let cases = [
        ("ClientStalled", RelayError::ClientStalled),
        ("EmulatorStalled", RelayError::EmulatorStalled),
        ("HeadTimeout", RelayError::HeadTimeout),
        ("ClientBodyFailed", RelayError::ClientBodyFailed),
        (
            "Unavailable(ConnectionFailed)",
            RelayError::Unavailable(Reason::ConnectionFailed {
                kind: "connection reset".to_owned(),
            }),
        ),
    ];
    for (name, error) in cases {
        let answer = relay_failing(error).await;
        assert_eq!(answer.headers[CONNECTION], "close", "case {name}");
    }
}

#[tokio::test]
async fn head_request_with_emulator_unavailable_is_503_with_headers_and_no_body() {
    let relay = TestRelay::answering(Script::Error(RelayError::Unavailable(Reason::NotStarted)));
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let answer = send(&app, empty(request(Method::HEAD, "/b/k"))).await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(answer.headers[CONTENT_TYPE], "application/json");
    assert_eq!(answer.headers["x-amzn-errortype"], "EmulatorUnavailable");
    assert!(answer.body.is_empty());
}

// ---- In-flight bound across relayed bodies (issue 2, D11) ----

struct HeldBodies {
    app: Router,
    relay: TestRelay,
    releases: mpsc::UnboundedReceiver<oneshot::Sender<()>>,
}

impl HeldBodies {
    fn new() -> HeldBodies {
        let (releases_tx, releases) = mpsc::unbounded_channel();
        let relay = TestRelay::answering(Script::Held {
            releases: releases_tx,
        });
        let app = app_relaying(reachable_probe(), relay.relay.clone());
        HeldBodies {
            app,
            relay,
            releases,
        }
    }

    /// A relayed `GET` whose head has returned and whose body is still open, with the sender that ends it.
    async fn hold(&mut self, path: &str) -> (axum::response::Response, oneshot::Sender<()>) {
        let response = self
            .app
            .clone()
            .oneshot(empty(request(Method::GET, path)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "held {path}");
        (response, self.releases.recv().await.unwrap())
    }
}

#[tokio::test(start_paused = true)]
async fn open_relayed_bodies_at_the_limit_make_every_request_busy_at_once() {
    let mut held = HeldBodies::new();
    let _first = held.hold("/b/1").await;
    let _second = held.hold("/b/2").await;

    let relayed = send_at_once(&held.app, empty(request(Method::GET, "/b/3"))).await;
    assert_eq!(
        relayed.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "case relayed"
    );
    assert_eq!(
        relayed.headers[CONTENT_TYPE], "application/json",
        "case relayed"
    );
    assert_eq!(relayed.aws_code(), "Busy", "case relayed");

    let health = send_at_once(&held.app, health_request()).await;
    assert_eq!(
        health.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "case health"
    );
    assert_eq!(health.code(), "Busy", "case health");

    assert_eq!(held.relay.seen().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn held_relayed_body_that_ends_frees_its_place() {
    let mut held = HeldBodies::new();
    let (first, release) = held.hold("/b/1").await;
    let _second = held.hold("/b/2").await;
    release.send(()).unwrap();
    let body = axum::body::to_bytes(first.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body, "first");
    assert_eq!(
        send_at_once(&held.app, health_request()).await.status,
        StatusCode::OK
    );
}

#[tokio::test(start_paused = true)]
async fn held_relayed_body_dropped_unfinished_frees_its_place() {
    let mut held = HeldBodies::new();
    let (first, _release) = held.hold("/b/1").await;
    let _second = held.hold("/b/2").await;
    drop(first);
    assert_eq!(
        send_at_once(&held.app, health_request()).await.status,
        StatusCode::OK
    );
}

#[tokio::test(start_paused = true)]
async fn held_health_requests_make_a_relayed_request_busy_without_relaying() {
    let mut held = Held::new(2);
    let relay = TestRelay::answering(Script::ok());
    let app = app_relaying(held.probe.clone(), relay.relay.clone());
    let _first = spawn_get(&app, health_request());
    let _second = spawn_get(&app, health_request());
    held.wait_entered(2).await;
    let answer = send_at_once(&app, empty(request(Method::GET, "/b/k"))).await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(answer.aws_code(), "Busy");
    assert!(relay.seen().is_empty(), "relayed");
}

// ---- Listener (issue 2, L1) ----

/// A listener that accepts one in-memory connection, then none.
struct OneConnection(Option<DuplexStream>);

impl axum::serve::Listener for OneConnection {
    type Io = DuplexStream;
    type Addr = std::net::SocketAddr;

    async fn accept(&mut self) -> (DuplexStream, std::net::SocketAddr) {
        match self.0.take() {
            Some(stream) => (stream, ([127, 0, 0, 1], 50000).into()),
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> io::Result<std::net::SocketAddr> {
        Ok(([127, 0, 0, 1], 8297).into())
    }
}

const LARGE: usize = 1024 * 1024;

/// Serves `app` relaying a [`LARGE`] body over [`IdleListener`] on one in-memory connection whose client end,
/// with a `client_buffer`-byte buffer, is returned with the stand-in's report of its connection closing. The
/// test relay's download idle is an hour, so only the listener can end a stalled answer within it.
fn serve_large(
    client_buffer: usize,
) -> (DuplexStream, mpsc::UnboundedReceiver<tokio::time::Instant>) {
    let (closed_tx, closed) = mpsc::unbounded_channel();
    let limits = Limits {
        download_idle: Duration::from_secs(3600),
        ..Limits::DEFAULT
    };
    let relay = TestRelay::with_limits(
        Script::Large {
            size: LARGE,
            closed: closed_tx,
        },
        limits,
    );
    let app = app_relaying(reachable_probe(), relay.relay);
    let (client, server) = tokio::io::duplex(client_buffer);
    let listener = IdleListener::new(OneConnection(Some(server)), CLIENT_WRITE_IDLE);
    tokio::spawn(async move { axum::serve(listener, app).await });
    (client, closed)
}

const LARGE_REQUEST: &[u8] =
    b"GET /b/large HTTP/1.1\r\nHost: 127.0.0.1:8297\r\nConnection: close\r\n\r\n";

#[tokio::test(start_paused = true)]
async fn listener_client_that_reads_gets_the_whole_response() {
    let (mut client, _closed) = serve_large(64 * 1024);
    client.write_all(LARGE_REQUEST).await.unwrap();
    let mut received = Vec::new();
    client.read_to_end(&mut received).await.unwrap();
    let split = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    assert!(received.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert_eq!(received.len() - split, LARGE);
}

#[tokio::test(start_paused = true)]
async fn listener_client_that_stops_reading_is_closed_at_the_idle_bound() {
    let (mut client, mut closed) = serve_large(4 * 1024);
    let started = tokio::time::Instant::now();
    client.write_all(LARGE_REQUEST).await.unwrap();

    tokio::time::sleep(CLIENT_WRITE_IDLE - Duration::from_millis(1)).await;
    assert!(closed.try_recv().is_err(), "closed before the idle bound");

    let closed_at = tokio::time::timeout(Duration::from_secs(1), closed.recv())
        .await
        .expect("the response body was not dropped at the idle bound")
        .unwrap();
    let elapsed = closed_at - started;
    assert!(
        elapsed >= CLIENT_WRITE_IDLE && elapsed <= CLIENT_WRITE_IDLE + Duration::from_millis(1),
        "closed after {elapsed:?}, not at the idle bound"
    );
    let mut received = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), client.read_to_end(&mut received))
        .await
        .expect("the client connection was not closed")
        .unwrap();
    assert!(received.len() < LARGE, "the whole body arrived");
}

// ---- A chunk above the cap (issue 9) ----

const CHUNK_TOO_LARGE_MESSAGE: &str = "a chunk of the aws-chunked request body is larger than 1048576 bytes, the most the engine relays in one chunk; upload with smaller chunks";
const SIGNED_CHUNKS: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";

/// `request` answered by a test relay that returns `ChunkTooLarge`; the relay is called once.
async fn chunk_too_large(request: Request<Body>) -> Answer {
    let relay = TestRelay::answering(Script::Error(RelayError::ChunkTooLarge));
    let app = app_relaying(reachable_probe(), relay.relay.clone());
    let answer = send(&app, request).await;
    assert_eq!(relay.seen().len(), 1, "the relay was not called once");
    answer
}

/// The text of the first `<name>` element of an XML body.
fn xml_element(body: &str, name: &str) -> String {
    let open = format!("<{name}>");
    let start = body.find(&open).unwrap() + open.len();
    let end = body[start..].find(&format!("</{name}>")).unwrap() + start;
    body[start..end].to_owned()
}

#[tokio::test]
async fn chunk_too_large_is_400_in_the_callers_protocol_and_closes_the_connection() {
    let s3 = chunk_too_large(
        header_signed(Method::PUT, "/b/k", "s3")
            .header("x-amz-content-sha256", SIGNED_CHUNKS)
            .body(Body::from("0;chunk-signature="))
            .unwrap(),
    )
    .await;
    assert_eq!(s3.headers[CONTENT_TYPE], "application/xml", "case s3");
    assert!(
        s3.text().starts_with("<Error><Code>ChunkTooLarge</Code>"),
        "case s3: {}",
        s3.text()
    );
    let s3_message = xml_element(&s3.text(), "Message");

    let json = chunk_too_large(empty(
        header_signed(Method::POST, "/", "dynamodb")
            .header("x-amz-target", "DynamoDB_20120810.ListTables")
            .header(CONTENT_TYPE, "application/x-amz-json-1.0"),
    ))
    .await;
    assert_eq!(
        json.headers[CONTENT_TYPE], "application/x-amz-json-1.0",
        "case json"
    );
    assert_eq!(json.aws_code(), "ChunkTooLarge", "case json");
    let json_message = json.json()["message"].as_str().unwrap().to_owned();

    let query = chunk_too_large(empty(
        header_signed(Method::POST, "/", "iam").header(CONTENT_TYPE, FORM),
    ))
    .await;
    assert_eq!(query.headers[CONTENT_TYPE], "text/xml", "case query");
    let (error_type, code, query_message) = query_error(&query.text());
    assert_eq!(error_type, "Sender", "case query");
    assert_eq!(code, "ChunkTooLarge", "case query");

    let rest_json = chunk_too_large(empty(header_signed(
        Method::GET,
        "/2015-03-31/functions/",
        "lambda",
    )))
    .await;
    assert_eq!(
        rest_json.headers[CONTENT_TYPE], "application/json",
        "case rest-json"
    );
    assert_eq!(rest_json.aws_code(), "ChunkTooLarge", "case rest-json");
    let rest_json_message = rest_json.json()["message"].as_str().unwrap().to_owned();

    for (case, answer, message) in [
        ("s3", &s3, s3_message),
        ("json", &json, json_message),
        ("query", &query, query_message),
        ("rest-json", &rest_json, rest_json_message),
    ] {
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "case {case}");
        assert_eq!(message, CHUNK_TOO_LARGE_MESSAGE, "case {case}");
        assert_eq!(answer.headers[CONNECTION], "close", "case {case}");
    }
}

#[tokio::test]
async fn chunk_too_large_to_a_head_request_is_400_with_the_s3_headers_and_no_body() {
    let answer = chunk_too_large(empty(header_signed(Method::HEAD, "/b/k", "s3"))).await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    assert_eq!(answer.headers[CONTENT_TYPE], "application/xml");
    assert_eq!(answer.headers[CONNECTION], "close");
    assert!(answer.body.is_empty(), "{:?}", answer.body);
}

#[tokio::test]
async fn chunk_too_large_answer_carries_no_request_header_value() {
    let canaries = [
        "canary-user-agent-e9b",
        "canary-meta-e9b",
        "canary-encoding-e9b",
    ];
    let answer = chunk_too_large(
        header_signed(Method::PUT, "/b/k", "s3")
            .header("x-amz-content-sha256", SIGNED_CHUNKS)
            .header("user-agent", canaries[0])
            .header("x-amz-meta-note", canaries[1])
            .header("content-encoding", canaries[2])
            .body(Body::from("10000;chunk-signature="))
            .unwrap(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    let text = answer.text();
    for canary in canaries {
        assert!(!text.contains(canary), "{canary} in {text}");
    }
}

/// A relay seam that records the `X-Amz-Content-SHA256` and the body of each request it is handed, then answers
/// `Script::ok()` through `forward` with that body.
struct BodyRecorder {
    relay: RelayFn,
    seen: Arc<Mutex<Vec<Recorded>>>,
}

/// The `X-Amz-Content-SHA256` and the body of one request handed to the relay.
type Recorded = (Option<String>, Bytes);

impl BodyRecorder {
    fn new() -> BodyRecorder {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let relay: RelayFn = Arc::new(move |_emulator, request: Request<Body>| {
            let record = record.clone();
            Box::pin(async move {
                let (parts, body) = request.into_parts();
                let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
                let mode = parts
                    .headers
                    .get("x-amz-content-sha256")
                    .map(|value| value.to_str().unwrap().to_owned());
                record.lock().unwrap().push((mode, body.clone()));
                let (engine, emulator) = tokio::io::duplex(64 * 1024);
                tokio::spawn(stand_in(emulator, Script::ok(), false));
                forward(
                    engine,
                    Arc::new(AtomicBool::new(false)),
                    Prepared { head: parts },
                    Body::from(body),
                    &Limits::DEFAULT,
                )
                .await
            })
        });
        BodyRecorder { relay, seen }
    }
}

#[tokio::test]
async fn studio_signed_chunk_put_reaches_the_relay_with_its_mode_and_body_unchanged() {
    const STUDIO: &str = "http://127.0.0.1:8296";
    let recorder = BodyRecorder::new();
    let app = app_relaying(reachable_probe(), recorder.relay.clone());
    let session = app
        .clone()
        .oneshot(
            request(Method::GET, "/__emuforge/session")
                .header(ORIGIN, STUDIO)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session.status(), StatusCode::OK, "session");
    let session = axum::body::to_bytes(session.into_body(), usize::MAX)
        .await
        .unwrap();
    let token = serde_json::from_slice::<Value>(&session).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_owned();

    let body =
        format!("5;chunk-signature={SIGNATURE}\r\nhello\r\n0;chunk-signature={SIGNATURE}\r\n\r\n");
    let request = header_signed(Method::PUT, "/b/k", "s3")
        .header("x-amz-content-sha256", SIGNED_CHUNKS)
        .header("content-encoding", "aws-chunked")
        .header("x-amz-decoded-content-length", "5")
        .header(ORIGIN, STUDIO)
        .header("sec-fetch-site", "same-site")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-dest", "empty")
        .header("x-emuforge-session", &token)
        .body(Body::from(body.clone()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-amz-request-id"], "test-request-1");
    let answer = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(answer.as_ref(), b"<ListAllMyBucketsResult/>");

    let seen = recorder.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1, "the relay was not called once");
    assert_eq!(seen[0].0.as_deref(), Some(SIGNED_CHUNKS));
    assert_eq!(seen[0].1.as_ref(), body.as_bytes(), "the body unchanged");
}

// ---- Ending a connection after an early answer (issue 22) ----

/// A listener that accepts the in-memory connections sent to it.
struct Connections(mpsc::UnboundedReceiver<DuplexStream>);

impl axum::serve::Listener for Connections {
    type Io = DuplexStream;
    type Addr = std::net::SocketAddr;

    async fn accept(&mut self) -> (DuplexStream, std::net::SocketAddr) {
        match self.0.recv().await {
            Some(stream) => (stream, ([127, 0, 0, 1], 50000).into()),
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> io::Result<std::net::SocketAddr> {
        Ok(([127, 0, 0, 1], 8297).into())
    }
}

/// `app` served over [`IdleListener`] on in-memory connections, each opened by [`Served::connect`].
struct Served(mpsc::UnboundedSender<DuplexStream>);

impl Served {
    fn new(app: Router) -> Served {
        let (connections, accepted) = mpsc::unbounded_channel();
        let listener = IdleListener::new(Connections(accepted), CLIENT_WRITE_IDLE);
        tokio::spawn(async move { axum::serve(listener, app).await });
        Served(connections)
    }

    /// Opens a connection and returns its peer.
    fn connect(&self) -> DuplexStream {
        let (peer, server) = tokio::io::duplex(64 * 1024);
        self.0.send(server).unwrap();
        peer
    }
}

/// An answer as the peer read it.
struct Wire {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Wire {
    /// Splits the head from the body of `bytes`, which hold one answer.
    fn parse(bytes: &[u8]) -> Wire {
        let split = bytes
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .unwrap_or_else(|| panic!("no answer head in {:?}", String::from_utf8_lossy(bytes)));
        let head = std::str::from_utf8(&bytes[..split]).unwrap();
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers = lines
            .map(|line| {
                let (name, value) = line.split_once(':').unwrap();
                (name.to_ascii_lowercase(), value.trim().to_owned())
            })
            .collect();
        Wire {
            status,
            headers,
            body: bytes[split + 4..].to_vec(),
        }
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header, _)| header == name)
            .map(|(_, value)| value.as_str())
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).unwrap()
    }
}

/// Reads one answer whose body has a `Content-Length`, leaving the connection open.
async fn read_answer(peer: &mut DuplexStream) -> Wire {
    let mut bytes = Vec::new();
    let mut byte = [0; 1];
    while !bytes.ends_with(b"\r\n\r\n") {
        assert_eq!(
            peer.read(&mut byte).await.unwrap(),
            1,
            "the stream ended in the head"
        );
        bytes.push(byte[0]);
    }
    let length: usize = Wire::parse(&bytes)
        .header("content-length")
        .expect("no content-length")
        .parse()
        .unwrap();
    let mut body = vec![0; length];
    peer.read_exact(&mut body).await.unwrap();
    bytes.extend_from_slice(&body);
    Wire::parse(&bytes)
}

const UPLOAD: usize = 1024 * 1024;
const UPLOAD_WRITE: usize = 64 * 1024;

/// Request headers, by name and value.
type Headers = Vec<(&'static str, String)>;

/// The head of a `PUT` of [`UPLOAD`] bytes: the request line, `headers` and `Content-Length`.
fn upload_head(path: &str, headers: &Headers) -> String {
    let mut head = format!("PUT {path} HTTP/1.1\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("content-length: {UPLOAD}\r\n\r\n"));
    head
}

/// The headers of an S3 request header-signed with the client key, with the engine's `Host`; each of `extra`
/// replaces the header of its name or is added.
fn signed_s3(extra: &[(&'static str, &str)]) -> Headers {
    let mut headers: Headers = vec![
        ("host", ENGINE_HOST.to_owned()),
        (
            "authorization",
            format!(
                "AWS4-HMAC-SHA256 Credential={CLIENT_KEY}/20261115/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature={SIGNATURE}"
            ),
        ),
        ("x-amz-date", AMZ_DATE.to_owned()),
    ];
    headers.retain(|(name, _)| !extra.iter().any(|(other, _)| other == name));
    headers.extend(
        extra
            .iter()
            .map(|(name, value)| (*name, (*value).to_owned())),
    );
    headers
}

/// Sends `head`, then the whole [`UPLOAD`]-byte body in 64 KiB writes on a new connection, then reads until the
/// stream ends. Asserts every write completed and the stream ended cleanly (every byte, then EOF, no read error);
/// returns the answer.
async fn upload_ending_cleanly(served: &Served, head: &str, case: &str) -> Wire {
    let mut peer = served.connect();
    peer.write_all(head.as_bytes())
        .await
        .unwrap_or_else(|error| panic!("case {case}: the head write failed: {error}"));
    let chunk = vec![b'x'; UPLOAD_WRITE];
    for write in 0..UPLOAD / UPLOAD_WRITE {
        peer.write_all(&chunk)
            .await
            .unwrap_or_else(|error| panic!("case {case}: body write {write} failed: {error}"));
    }
    let mut received = Vec::new();
    peer.read_to_end(&mut received)
        .await
        .unwrap_or_else(|error| panic!("case {case}: the stream did not end cleanly: {error}"));
    Wire::parse(&received)
}

fn app_limited(relay: RelayFn, max_in_flight: usize) -> Router {
    app(AppState {
        engine_port: NonZeroU16::new(8297).unwrap(),
        studio_port: NonZeroU16::new(8296).unwrap(),
        form: Form::Native,
        home: PathBuf::from("/h"),
        settings: absent_settings(),
        probe: reachable_probe(),
        relay,
        test: Arc::new(|_| Box::pin(async { emuforge_core::TestReport { checks: Vec::new() } })),
        max_in_flight,
        studio_origin: StudioOrigin::new(NonZeroU16::new(8296).unwrap()),
        session: Arc::new(SessionToken::generate().unwrap()),
    })
}

#[tokio::test(start_paused = true)]
async fn chunk_too_large_before_the_body_is_read_lets_the_client_send_it_all_and_ends_cleanly() {
    let relay = TestRelay::answering(Script::Error(RelayError::ChunkTooLarge));
    let served = Served::new(app_relaying(reachable_probe(), relay.relay.clone()));
    let headers = signed_s3(&[("x-amz-content-sha256", SIGNED_CHUNKS)]);
    let answer =
        upload_ending_cleanly(&served, &upload_head("/b/k", &headers), "chunk too large").await;
    assert_eq!(answer.status, 400);
    assert_eq!(xml_element(&answer.text(), "Code"), "ChunkTooLarge");
    assert_eq!(answer.header("connection"), Some("close"));
    assert_eq!(relay.seen().len(), 1, "the relay was not called once");
}

#[tokio::test(start_paused = true)]
async fn early_emulator_answer_lets_the_client_send_it_all_and_ends_cleanly() {
    let relay = TestRelay::answering(Script::Early {
        status: 413,
        body: b"<Error><Code>EntityTooLarge</Code></Error>",
    });
    let served = Served::new(app_relaying(reachable_probe(), relay.relay.clone()));
    let headers = signed_s3(&[]);
    let answer = upload_ending_cleanly(&served, &upload_head("/b/k", &headers), "early 413").await;
    assert_eq!(answer.status, 413);
    assert_eq!(answer.header("connection"), Some("close"));
    assert_eq!(answer.text(), "<Error><Code>EntityTooLarge</Code></Error>");
}

/// `app`'s answer to `request` without a connection, CORS headers included.
async fn answer_of(app: &Router, request: Request<Body>) -> Answer {
    let response = tokio::time::timeout(Duration::from_secs(1), app.clone().oneshot(request))
        .await
        .expect("the request waited instead of answering at once")
        .unwrap();
    let (parts, body) = response.into_parts();
    Answer {
        status: parts.status,
        headers: parts.headers,
        body: axum::body::to_bytes(body, usize::MAX).await.unwrap(),
    }
}

/// The same answer `app` gives to `request` without a connection: status, every value of every header it sets,
/// in order, and body.
fn assert_unchanged(wire: &Wire, direct: &Answer, case: &str) {
    assert_eq!(wire.status, direct.status.as_u16(), "case {case}");
    for name in direct.headers.keys() {
        let expected = direct
            .headers
            .get_all(name)
            .iter()
            .map(|value| value.to_str().unwrap())
            .collect::<Vec<_>>();
        let seen = wire
            .headers
            .iter()
            .filter(|(header, _)| header == name.as_str())
            .map(|(_, value)| value.as_str())
            .collect::<Vec<_>>();
        assert_eq!(seen, expected, "case {case}: header {name}");
    }
    assert_eq!(wire.body, direct.body.as_ref(), "case {case}: body");
}

/// A request answered before its body is read, with the app that answers it and the status it gets.
struct EarlyCase {
    case: &'static str,
    app: Router,
    path: &'static str,
    headers: Headers,
    status: u16,
}

#[tokio::test(start_paused = true)]
async fn answers_before_the_body_is_read_let_the_client_send_it_all_and_end_cleanly() {
    const STUDIO: &str = "http://127.0.0.1:8296";
    let unavailable =
        TestRelay::answering(Script::Error(RelayError::Unavailable(Reason::NotStarted)));
    let ok = TestRelay::answering(Script::ok());
    let mut held = Held::new(2);
    let busy_app = app_relaying(held.probe.clone(), ok.relay.clone());
    let _first = spawn_get(&busy_app, health_request());
    let _second = spawn_get(&busy_app, health_request());
    held.wait_entered(2).await;
    let refusing = || app_relaying(reachable_probe(), ok.relay.clone());
    let host: Headers = vec![("host", ENGINE_HOST.to_owned())];
    let cases = [
        EarlyCase {
            case: "503 Busy",
            app: busy_app,
            path: "/b/k",
            headers: signed_s3(&[]),
            status: 503,
        },
        EarlyCase {
            case: "503 EmulatorUnavailable",
            app: app_relaying(reachable_probe(), unavailable.relay.clone()),
            path: "/b/k",
            headers: signed_s3(&[]),
            status: 503,
        },
        EarlyCase {
            case: "foreign Host",
            app: refusing(),
            path: "/b/k",
            headers: signed_s3(&[("host", "example.com:8297")]),
            status: 421,
        },
        EarlyCase {
            case: "foreign Origin",
            app: refusing(),
            path: "/b/k",
            headers: signed_s3(&[("origin", "http://example.com")]),
            status: 403,
        },
        EarlyCase {
            case: "unidentified caller",
            app: refusing(),
            path: "/b/k",
            headers: signed_s3(&[("origin", STUDIO)]),
            status: 401,
        },
        EarlyCase {
            case: "404 NotFound",
            app: refusing(),
            path: "/__emuforge/other",
            headers: host.clone(),
            status: 404,
        },
        EarlyCase {
            case: "405 MethodNotAllowed",
            app: refusing(),
            path: HEALTH,
            headers: host,
            status: 405,
        },
    ];
    for EarlyCase {
        case,
        app,
        path,
        headers,
        status,
    } in cases
    {
        let mut direct = Request::builder().method(Method::PUT).uri(path);
        for (name, value) in &headers {
            direct = direct.header(*name, value);
        }
        let direct = answer_of(&app, direct.body(Body::from(vec![b'x'; UPLOAD])).unwrap()).await;
        assert_eq!(direct.status.as_u16(), status, "case {case}: direct");
        let served = Served::new(app);
        let wire = upload_ending_cleanly(&served, &upload_head(path, &headers), case).await;
        assert_unchanged(&wire, &direct, case);
    }
    assert!(ok.seen().is_empty(), "a refused request was relayed");
}

#[tokio::test(start_paused = true)]
async fn draining_connection_holds_no_in_flight_permit() {
    let relay = TestRelay::answering(Script::Error(RelayError::ChunkTooLarge));
    let served = Served::new(app_limited(relay.relay.clone(), 1));
    let headers = signed_s3(&[("x-amz-content-sha256", SIGNED_CHUNKS)]);
    let started = tokio::time::Instant::now();
    let mut draining = served.connect();
    draining
        .write_all(upload_head("/b/k", &headers).as_bytes())
        .await
        .unwrap();
    let mut received = Vec::new();
    draining.read_to_end(&mut received).await.unwrap();
    assert_eq!(Wire::parse(&received).status, 400, "the first answer");

    let mut second = served.connect();
    second
        .write_all(
            b"GET /__emuforge/health HTTP/1.1\r\nHost: 127.0.0.1:8297\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
    let answer = read_answer(&mut second).await;
    assert_eq!(answer.status, 200, "{}", answer.text());
    assert!(started.elapsed() < DRAIN_BOUND, "the drain bound passed");
    draining
        .write_all(b"x")
        .await
        .expect("the first connection no longer drains");
}

#[tokio::test(start_paused = true)]
async fn keep_alive_connection_answers_a_second_request_without_a_drain_between() {
    let served = Served::new(app_with(reachable_probe()));
    let mut peer = served.connect();
    for request in ["first", "second"] {
        peer.write_all(b"GET /__emuforge/health HTTP/1.1\r\nHost: 127.0.0.1:8297\r\n\r\n")
            .await
            .unwrap();
        let answer = read_answer(&mut peer).await;
        assert_eq!(answer.status, 200, "case {request}");
        assert_eq!(answer.header("connection"), None, "case {request}");
    }
}

// ---- Issue 485: health and relay follow the active target of the settings file ----

/// An app whose settings folder is `dir` (seed `local` at 9391), whose probe and relay record the `Emulator`
/// each was given; the probe answers `probed`, the relay `relayed`.
struct Following {
    app: Router,
    probed: Arc<Mutex<Vec<Emulator>>>,
    relayed: Arc<Mutex<Vec<Emulator>>>,
}

impl Following {
    fn new(dir: &Path, probe_answers: Health, script: Script) -> Following {
        let probed = Arc::new(Mutex::new(Vec::new()));
        let relayed = Arc::new(Mutex::new(Vec::new()));
        let (probe_seen, relay_seen) = (probed.clone(), relayed.clone());
        let probe: ProbeFn = Arc::new(move |emulator| {
            probe_seen.lock().unwrap().push(emulator);
            let health = probe_answers.clone();
            Box::pin(async move { health })
        });
        let inner = TestRelay::answering(script).relay;
        let relay: RelayFn = Arc::new(move |emulator: Emulator, request: Request<Body>| {
            relay_seen.lock().unwrap().push(emulator.clone());
            inner(emulator, request)
        });
        let app = app(AppState {
            engine_port: NonZeroU16::new(8297).unwrap(),
            studio_port: NonZeroU16::new(8296).unwrap(),
            form: Form::Native,
            home: PathBuf::from("/h"),
            settings: Arc::new(Store::new(
                dir.to_owned(),
                seed_settings(Form::Native, NonZeroU16::new(9391).unwrap()),
            )),
            probe,
            relay,
            test: Arc::new(|_| {
                Box::pin(async { emuforge_core::TestReport { checks: Vec::new() } })
            }),
            max_in_flight: 2,
            studio_origin: StudioOrigin::new(NonZeroU16::new(8296).unwrap()),
            session: Arc::new(SessionToken::generate().unwrap()),
        });
        Following {
            app,
            probed,
            relayed,
        }
    }

    fn probed(&self) -> Vec<String> {
        addresses(&self.probed)
    }

    fn relayed(&self) -> Vec<String> {
        addresses(&self.relayed)
    }
}

fn addresses(seen: &Mutex<Vec<Emulator>>) -> Vec<String> {
    seen.lock()
        .unwrap()
        .iter()
        .map(|emulator| emulator.socket_addr().to_string())
        .collect()
}

/// A settings file of two targets, `local` at 9391 and `other` at `endpoint`, `active` the active one.
fn two_targets(dir: &Path, active: &str, endpoint: &str) {
    std::fs::write(
        dir.join(SETTINGS_FILE),
        format!(
            r#"{{"version":1,"active":"{active}","targets":[{{"name":"local","endpoint":"https://127.0.0.1:9391"}},{{"name":"other","endpoint":"{endpoint}"}}]}}"#
        ),
    )
    .unwrap();
}

const UNUSABLE_SETTINGS: &str = r#"{"version":1,"active":"local","targets":[]"#;

#[tokio::test]
async fn health_with_the_file_absent_probes_local_and_names_it() {
    let dir = tempfile::tempdir().unwrap();
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());
    let answer = get(&following.app, HEALTH).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(following.probed(), vec!["127.0.0.1:9391"]);
    assert_eq!(
        answer.json(),
        json!({"target": "local", "emulator": {
            "port": 9391,
            "endpoint": "https://127.0.0.1:9391",
            "reachable": true,
        }})
    );
}

#[tokio::test]
async fn health_with_another_active_target_probes_it_and_names_it_and_its_endpoint() {
    let dir = tempfile::tempdir().unwrap();
    two_targets(dir.path(), "other", "https://127.0.0.2:9500");
    let following = Following::new(
        dir.path(),
        Health::Unreachable(Reason::ConnectionRefused),
        Script::ok(),
    );
    let answer = get(&following.app, HEALTH).await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(following.probed(), vec!["127.0.0.2:9500"]);
    let body = answer.json();
    assert_eq!(body["target"], "other");
    assert_eq!(body["emulator"]["port"], 9500);
    assert_eq!(body["emulator"]["endpoint"], "https://127.0.0.2:9500");
    assert_eq!(body["emulator"]["reason"], "connection_refused");
}

#[tokio::test]
async fn health_with_an_unusable_file_is_503_settings_unusable_naming_it_and_probes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    std::fs::write(&file, UNUSABLE_SETTINGS).unwrap();
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());
    let answer = get(&following.app, HEALTH).await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(answer.code(), "SettingsUnusable");
    let message = answer.json()["error"]["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(message.contains(&file.display().to_string()), "{message}");
    assert!(following.probed().is_empty(), "probed");
}

#[tokio::test]
async fn relayed_requests_each_go_to_the_target_active_at_their_start() {
    let dir = tempfile::tempdir().unwrap();
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());
    let send_one = || {
        send(
            &following.app,
            empty(header_signed(Method::GET, "/b/k", "s3")),
        )
    };
    assert_eq!(send_one().await.status, StatusCode::OK);
    two_targets(dir.path(), "other", "https://127.0.0.2:9500");
    assert_eq!(send_one().await.status, StatusCode::OK);
    two_targets(dir.path(), "local", "https://127.0.0.2:9500");
    assert_eq!(send_one().await.status, StatusCode::OK);
    assert_eq!(
        following.relayed(),
        vec!["127.0.0.1:9391", "127.0.0.2:9500", "127.0.0.1:9391"]
    );
}

#[tokio::test]
async fn relayed_request_with_an_unusable_file_is_503_settings_unusable_in_the_callers_protocol() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(SETTINGS_FILE);
    std::fs::write(&file, UNUSABLE_SETTINGS).unwrap();
    let file = file.display().to_string();
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());

    let json = send(
        &following.app,
        empty(
            header_signed(Method::POST, "/", "dynamodb")
                .header("x-amz-target", "DynamoDB_20120810.ListTables")
                .header(CONTENT_TYPE, "application/x-amz-json-1.0"),
        ),
    )
    .await;
    assert_eq!(json.status, StatusCode::SERVICE_UNAVAILABLE, "case JSON");
    assert_eq!(
        json.headers[CONTENT_TYPE], "application/x-amz-json-1.0",
        "case JSON"
    );
    assert_eq!(json.aws_code(), "SettingsUnusable", "case JSON");
    assert!(json.text().contains(&file), "case JSON: {}", json.text());

    let rest_xml = send(
        &following.app,
        empty(header_signed(Method::GET, "/b/k", "s3")),
    )
    .await;
    assert_eq!(
        rest_xml.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "case REST-XML"
    );
    assert_eq!(
        rest_xml.headers[CONTENT_TYPE], "application/xml",
        "case REST-XML"
    );
    assert!(
        rest_xml
            .text()
            .starts_with("<Error><Code>SettingsUnusable</Code><Message>"),
        "case REST-XML: {}",
        rest_xml.text()
    );
    assert!(rest_xml.text().contains(&file), "case REST-XML");

    let query = send(
        &following.app,
        empty(header_signed(Method::POST, "/", "iam").header(CONTENT_TYPE, FORM)),
    )
    .await;
    assert_eq!(query.status, StatusCode::SERVICE_UNAVAILABLE, "case Query");
    assert_eq!(query.headers[CONTENT_TYPE], "text/xml", "case Query");
    let (kind, code, message) = query_error(&query.text());
    assert_eq!(
        (kind.as_str(), code.as_str()),
        ("Receiver", "SettingsUnusable"),
        "case Query"
    );
    assert!(message.contains(&file), "case Query: {message}");

    let unsigned = send(&following.app, empty(request(Method::GET, "/b/k"))).await;
    assert_eq!(
        unsigned.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "case unsigned"
    );
    assert_eq!(
        unsigned.headers[CONTENT_TYPE], "application/json",
        "case unsigned"
    );
    assert_eq!(unsigned.aws_code(), "SettingsUnusable", "case unsigned");

    assert!(following.relayed().is_empty(), "relayed");
}

#[tokio::test]
async fn relayed_request_to_an_unreachable_active_target_is_503_naming_that_targets_endpoint_only()
{
    let dir = tempfile::tempdir().unwrap();
    two_targets(dir.path(), "other", "https://127.0.0.2:9500");
    let following = Following::new(
        dir.path(),
        Health::Reachable,
        Script::Error(RelayError::Unavailable(Reason::ConnectionRefused)),
    );
    let answer = send(
        &following.app,
        empty(header_signed(Method::POST, "/", "iam").header(CONTENT_TYPE, FORM)),
    )
    .await;
    assert_eq!(answer.status, StatusCode::SERVICE_UNAVAILABLE);
    let (_, code, message) = query_error(&answer.text());
    assert_eq!(code, "EmulatorUnavailable");
    assert!(message.contains("https://127.0.0.2:9500"), "{message}");
    assert!(!message.contains("9391"), "{message}");
    assert_eq!(following.relayed(), vec!["127.0.0.2:9500"]);
}

#[tokio::test]
async fn serving_health_and_relayed_requests_with_the_file_absent_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());
    assert_eq!(get(&following.app, HEALTH).await.status, StatusCode::OK);
    let relayed = send(
        &following.app,
        empty(header_signed(Method::GET, "/b/k", "s3")),
    )
    .await;
    assert_eq!(relayed.status, StatusCode::OK);
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "the settings folder is not empty"
    );
}

#[tokio::test]
async fn an_active_target_at_the_engines_own_port_is_read_and_given_to_relay_and_probe() {
    let dir = tempfile::tempdir().unwrap();
    two_targets(dir.path(), "other", "https://127.0.0.1:8297");
    let following = Following::new(dir.path(), Health::Reachable, Script::ok());
    let health = get(&following.app, HEALTH).await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.json()["target"], "other");
    assert_eq!(
        health.json()["emulator"]["endpoint"],
        "https://127.0.0.1:8297"
    );
    let relayed = send(
        &following.app,
        empty(header_signed(Method::GET, "/b/k", "s3")),
    )
    .await;
    assert_eq!(relayed.status, StatusCode::OK);
    assert_eq!(following.probed(), vec!["127.0.0.1:8297"]);
    assert_eq!(following.relayed(), vec!["127.0.0.1:8297"]);
}
