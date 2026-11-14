#![cfg(test)]

use std::io;
use std::num::NonZeroU16;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::header::{ALLOW, CONTENT_TYPE, HOST, ORIGIN};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use emuforge_core::{Emulator, Health, Reason};
use emuforge_server::{AppState, ProbeFn, app};
use hyper::body::{Bytes, Frame};
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};
use tower::ServiceExt;

const ENGINE_HOST: &str = "127.0.0.1:8297";
const HEALTH: &str = "/__emuforge/health";

fn emulator() -> Emulator {
    Emulator::new(Path::new("/h"), NonZeroU16::new(9391).unwrap())
}

fn app_with(probe: ProbeFn) -> Router {
    app(AppState {
        engine_port: NonZeroU16::new(8297).unwrap(),
        emulator: emulator(),
        probe,
        max_in_flight: 2,
    })
}

/// A probe that answers `healths` in order, repeating the last, and counts its calls.
fn answering(healths: Vec<Health>) -> (ProbeFn, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let probe: ProbeFn = Arc::new(move || {
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
        r#"{"emulator":{"port":9391,"endpoint":"https://127.0.0.1:9391","reachable":true}}"#
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
            json!({"emulator": {
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
    for path in ["/", "/other", "/__emuforge", "/__emuforge/health/x"] {
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
    let other_with_origin = request(Method::GET, "/other")
        .header(ORIGIN, "https://example.com")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        send(&app, other_with_origin).await.status,
        StatusCode::FORBIDDEN
    );
    let post_other = request(Method::POST, "/other").body(Body::empty()).unwrap();
    assert_eq!(send(&app, post_other).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn refusals_are_json_error_bodies() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let app = app_with(probe);
    let cases = [
        (
            "GET /other",
            request(Method::GET, "/other").body(Body::empty()).unwrap(),
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
        let probe: ProbeFn = Arc::new(move || {
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
            "GET /other",
            request(Method::GET, "/other").body(Body::empty()).unwrap(),
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
