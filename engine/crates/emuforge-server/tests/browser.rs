#![cfg(test)]

//! The router as a browser at the Studio origin, a foreign page and a local tool see it (issue 7).

use std::io;
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_MAX_AGE, ACCESS_CONTROL_REQUEST_HEADERS,
    ACCESS_CONTROL_REQUEST_METHOD, ALLOW, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, COOKIE, HOST,
    ORIGIN, VARY, WWW_AUTHENTICATE,
};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode};
use emuforge_core::{Emulator, Health, Limits, Prepared, Reason, Store, forward};
use emuforge_server::{
    AcceptedHosts, AppState, Form, ProbeFn, RelayFn, SessionToken, StudioOrigin, app, seed_settings,
};
use hyper::body::{Bytes, Frame};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Notify, mpsc};
use tower::ServiceExt;

/// The Studio origin of every `app` here.
const S: &str = "http://127.0.0.1:8296";
const ENGINE_HOST: &str = "127.0.0.1:8297";
const HEALTH: &str = "/__emuforge/health";
const SESSION: &str = "/__emuforge/session";
const SESSION_HEADER: &str = "x-emuforge-session";
/// The body the test relay answers every request with.
const RELAYED: &str = "the test relay's answer";

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

fn emulator() -> Emulator {
    Emulator::new(Path::new("/h"), port(9391))
}

/// A store whose folder does not exist: every load is the seed, `local` at `https://127.0.0.1:9391`.
fn absent_settings() -> Arc<Store> {
    Arc::new(Store::new(
        PathBuf::from("/h/.config/emuforge"),
        seed_settings(Form::Native, NonZeroU16::new(9391).unwrap()),
    ))
}

fn app_with(probe: ProbeFn) -> Router {
    app_relaying(probe, test_relay().0)
}

fn app_relaying(probe: ProbeFn, relay: RelayFn) -> Router {
    app(AppState {
        engine_port: port(8297),
        studio_port: NonZeroU16::new(8296).unwrap(),
        form: Form::Native,
        home: PathBuf::from("/h"),
        settings: absent_settings(),
        probe,
        relay,
        test: Arc::new(|_| Box::pin(async { emuforge_core::TestReport { checks: Vec::new() } })),
        max_in_flight: 2,
        studio_origin: StudioOrigin::new(port(8296)),
        accepted_hosts: AcceptedHosts::new(port(8296), Vec::new()),
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

/// A relay that answers every request `200` with [`RELAYED`] from a stand-in on the other side of a duplex
/// stream, and counts its calls.
fn test_relay() -> (RelayFn, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let relay: RelayFn = Arc::new(move |_emulator, request: Request<Body>| {
        counter.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            let (engine, mut emulator) = tokio::io::duplex(64 * 1024);
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut byte = [0; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    if emulator.read(&mut byte).await.unwrap_or(0) == 0 {
                        return;
                    }
                    head.push(byte[0]);
                }
                let answer = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{RELAYED}",
                    RELAYED.len()
                );
                let _ = emulator.write_all(answer.as_bytes()).await;
            });
            let (parts, body) = request.into_parts();
            forward(
                engine,
                Arc::new(AtomicBool::new(false)),
                Prepared { head: parts },
                body,
                &Limits::DEFAULT,
            )
            .await
        })
    });
    (relay, calls)
}

fn reachable() -> (Router, Arc<AtomicUsize>) {
    let (probe, calls) = answering(vec![Health::Reachable]);
    (app_with(probe), calls)
}

fn request(method: Method, path: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, ENGINE_HOST)
}

/// `method path` from the Studio origin.
fn studio(method: Method, path: &str) -> axum::http::request::Builder {
    request(method, path).header(ORIGIN, S)
}

/// `method path` from the Studio origin with `token`.
fn studio_with(method: Method, path: &str, token: &str) -> Request<Body> {
    studio(method, path)
        .header(SESSION_HEADER, token)
        .body(Body::empty())
        .unwrap()
}

fn preflight(path: &str, from: &str, method: &str) -> Request<Body> {
    request(Method::OPTIONS, path)
        .header(ORIGIN, from)
        .header(ACCESS_CONTROL_REQUEST_METHOD, method)
        .header(ACCESS_CONTROL_REQUEST_HEADERS, SESSION_HEADER)
        .body(Body::empty())
        .unwrap()
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

    fn message(&self) -> String {
        self.json()["error"]["message"].as_str().unwrap().to_owned()
    }

    fn values(&self, name: impl axum::http::header::AsHeaderName) -> Vec<&str> {
        self.headers
            .get_all(name)
            .iter()
            .map(|value| value.to_str().unwrap())
            .collect()
    }

    /// `Access-Control-Allow-Origin` is exactly the Studio origin, once.
    fn assert_cors(&self, case: &str) {
        assert_eq!(
            self.values(ACCESS_CONTROL_ALLOW_ORIGIN),
            [S],
            "case {case}: Access-Control-Allow-Origin"
        );
        assert!(
            !self.headers.contains_key(ACCESS_CONTROL_ALLOW_CREDENTIALS),
            "case {case}: Access-Control-Allow-Credentials"
        );
    }

    /// No `Access-Control-*` header at all.
    fn assert_no_cors(&self, case: &str) {
        for name in self.headers.keys() {
            assert!(
                !name.as_str().starts_with("access-control-"),
                "case {case}: {name} on {}",
                self.status
            );
        }
    }

    fn assert_vary_origin(&self, case: &str) {
        assert_eq!(self.values(VARY), ["Origin"], "case {case}: Vary");
    }

    /// An answer to the Studio origin: `Vary` is `Origin` and `X-EmuForge-Session`, one line each, so a browser
    /// never reuses it for a request with another session header or none (issue 24 D2).
    fn assert_vary_studio(&self, case: &str) {
        assert_eq!(
            self.values(VARY),
            ["Origin", "X-EmuForge-Session"],
            "case {case}: Vary"
        );
    }

    fn assert_error(&self, status: StatusCode, code: &str, case: &str) {
        assert_eq!(self.status, status, "case {case}: status");
        assert_eq!(
            self.headers[CONTENT_TYPE], "application/json",
            "case {case}"
        );
        assert_eq!(self.code(), code, "case {case}: code");
    }

    /// A refusal on a relayed path, in the caller's protocol: REST-JSON for these requests (no `X-Amz-Target`, no
    /// `s3` credential, no form body or `Action=` query), so the code is read from `x-amzn-ErrorType` and `__type`.
    fn assert_aws_error(&self, status: StatusCode, code: &str, case: &str) {
        assert_eq!(self.status, status, "case {case}: status");
        assert_eq!(
            self.headers[CONTENT_TYPE], "application/json",
            "case {case}"
        );
        assert_eq!(
            self.values("x-amzn-errortype"),
            [code],
            "case {case}: x-amzn-ErrorType"
        );
        assert_eq!(self.json()["__type"], code, "case {case}: __type");
    }

    fn assert_www_authenticate(&self, case: &str) {
        assert_eq!(
            self.values(WWW_AUTHENTICATE),
            ["EmuForge-Session"],
            "case {case}: WWW-Authenticate"
        );
    }

    fn assert_no_token(&self, token: &str, case: &str) {
        assert!(
            !String::from_utf8_lossy(&self.body).contains(token),
            "case {case}: the token is in the body"
        );
        for (name, value) in &self.headers {
            assert!(
                !String::from_utf8_lossy(value.as_bytes()).contains(token),
                "case {case}: the token is in header {name}"
            );
        }
    }
}

async fn send(app: &Router, request: Request<Body>) -> Answer {
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    Answer {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}

/// The token, obtained as Studio obtains it.
async fn token(app: &Router) -> String {
    let answer = send(
        app,
        studio(Method::GET, SESSION).body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK, "session");
    answer.json()["token"].as_str().unwrap().to_owned()
}

/// A 64-hex token of another `app`.
async fn foreign_token() -> String {
    token(&reachable().0).await
}

fn health_body(health: &Health) -> Value {
    match health {
        Health::Reachable => json!({"target": "local", "emulator": {
            "port": 9391,
            "endpoint": "https://127.0.0.1:9391",
            "reachable": true,
        }}),
        Health::Unreachable(reason) => json!({"target": "local", "emulator": {
            "port": 9391,
            "endpoint": "https://127.0.0.1:9391",
            "reachable": false,
            "reason": reason.code(),
            "message": reason.message(&emulator()),
        }}),
    }
}

#[tokio::test]
async fn session_from_studio_is_200_with_the_token_and_cors_without_probe() {
    let (app, calls) = reachable();
    let answer = send(
        &app,
        studio(Method::GET, SESSION).body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.headers[CONTENT_TYPE], "application/json");
    assert_eq!(answer.values(CACHE_CONTROL), ["no-store"]);
    answer.assert_cors("session");
    answer.assert_vary_studio("session");
    let body = answer.json();
    let object = body.as_object().unwrap();
    assert_eq!(object.len(), 1, "{body}");
    let token = object["token"].as_str().unwrap();
    assert_eq!(token.len(), 64);
    assert!(
        token
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "not lowercase hex"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn session_twice_from_studio_gives_the_same_token() {
    let (app, _) = reachable();
    assert_eq!(token(&app).await, token(&app).await);
}

#[tokio::test]
async fn session_with_another_apps_token_is_200_with_this_apps_token() {
    let (app, _) = reachable();
    let own = token(&app).await;
    let other = foreign_token().await;
    let answer = send(&app, studio_with(Method::GET, SESSION, &other)).await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.json()["token"], own.as_str());
}

#[tokio::test]
async fn session_head_from_studio_is_200_with_cors_and_no_body() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        studio(Method::HEAD, SESSION).body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK);
    answer.assert_cors("HEAD session");
    assert_eq!(answer.values(CACHE_CONTROL), ["no-store"]);
    assert!(answer.body.is_empty());
}

#[tokio::test]
async fn session_without_origin_is_403_naming_the_studio_origin() {
    let (app, _) = reachable();
    let token = token(&app).await;
    for method in [Method::GET, Method::HEAD] {
        let case = method.as_str();
        let answer = send(
            &app,
            request(method.clone(), SESSION)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "case {case}");
        answer.assert_no_cors(case);
        answer.assert_no_token(&token, case);
        if method == Method::GET {
            assert_eq!(answer.code(), "OriginNotAllowed", "case {case}");
            assert!(
                answer.message().contains(S),
                "case {case}: {}",
                answer.message()
            );
        } else {
            // A HEAD answer has no body by HTTP; its status and type are those of GET.
            assert_eq!(
                answer.headers[CONTENT_TYPE], "application/json",
                "case {case}"
            );
            assert!(answer.body.is_empty(), "case {case}");
        }
    }
}

#[tokio::test]
async fn session_post_without_origin_is_405_allowing_get_and_head() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        request(Method::POST, SESSION).body(Body::empty()).unwrap(),
    )
    .await;
    answer.assert_error(
        StatusCode::METHOD_NOT_ALLOWED,
        "MethodNotAllowed",
        "POST session",
    );
    assert_eq!(answer.values(ALLOW), ["GET, HEAD"]);
}

fn assert_preflight(answer: &Answer, case: &str) {
    assert_eq!(answer.status, StatusCode::NO_CONTENT, "case {case}");
    assert!(answer.body.is_empty(), "case {case}");
    answer.assert_cors(case);
    assert_eq!(
        answer.values(ACCESS_CONTROL_ALLOW_METHODS),
        ["GET, HEAD, POST, DELETE"],
        "case {case}"
    );
    assert_eq!(
        answer.values(ACCESS_CONTROL_ALLOW_HEADERS),
        ["Content-Type, X-EmuForge-Session"],
        "case {case}"
    );
    assert_eq!(
        answer.values(ACCESS_CONTROL_MAX_AGE),
        ["600"],
        "case {case}"
    );
    answer.assert_vary_studio(case);
}

#[tokio::test]
async fn preflight_from_studio_on_health_is_204_without_probe() {
    let (app, calls) = reachable();
    let answer = send(&app, preflight(HEALTH, S, "GET")).await;
    assert_preflight(&answer, "preflight health");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn preflight_from_studio_for_any_method_or_engine_path_is_the_same_204() {
    let (app, _) = reachable();
    let cases = [
        ("method POST", preflight(HEALTH, S, "POST")),
        ("session path", preflight(SESSION, S, "GET")),
        ("missing path", preflight("/__emuforge/missing", S, "GET")),
    ];
    for (case, request) in cases {
        assert_preflight(&send(&app, request).await, case);
    }
}

#[tokio::test]
async fn options_from_studio_without_request_method_is_401_session_required() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        studio(Method::OPTIONS, HEALTH).body(Body::empty()).unwrap(),
    )
    .await;
    answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", "OPTIONS");
    answer.assert_cors("OPTIONS");
}

#[tokio::test]
async fn health_from_studio_with_token_is_1s_answer_with_cors() {
    let healths = vec![Health::Reachable, Health::Unreachable(Reason::NotStarted)];
    let (probe, _) = answering(healths.clone());
    let app = app_with(probe);
    let token = token(&app).await;
    for (health, status) in healths
        .iter()
        .zip([StatusCode::OK, StatusCode::SERVICE_UNAVAILABLE])
    {
        let case = status.as_str();
        let answer = send(&app, studio_with(Method::GET, HEALTH, &token)).await;
        assert_eq!(answer.status, status, "case {case}");
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {case}"
        );
        assert_eq!(answer.json(), health_body(health), "case {case}");
        answer.assert_cors(case);
        answer.assert_vary_studio(case);
    }
}

#[tokio::test]
async fn health_head_from_studio_with_token_is_200_with_cors_and_no_body() {
    let (app, _) = reachable();
    let token = token(&app).await;
    let answer = send(&app, studio_with(Method::HEAD, HEALTH, &token)).await;
    assert_eq!(answer.status, StatusCode::OK);
    answer.assert_cors("HEAD health");
    assert!(answer.body.is_empty());
}

#[tokio::test]
async fn health_from_studio_without_token_is_401_session_required_without_probe() {
    let (app, calls) = reachable();
    let answer = send(
        &app,
        studio(Method::GET, HEALTH).body(Body::empty()).unwrap(),
    )
    .await;
    answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", "no token");
    answer.assert_www_authenticate("no token");
    answer.assert_cors("no token");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn health_from_studio_without_token_is_401_varying_on_origin_and_the_session() {
    let (app, calls) = reachable();
    let answer = send(
        &app,
        studio(Method::GET, HEALTH).body(Body::empty()).unwrap(),
    )
    .await;
    answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", "no token");
    answer.assert_vary_studio("no token");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn health_from_studio_with_a_wrong_token_is_401_session_invalid_without_probe() {
    let (app, calls) = reachable();
    let token = token(&app).await;
    let mut last_changed = token.clone();
    let last = if last_changed.ends_with('0') {
        "1"
    } else {
        "0"
    };
    last_changed.replace_range(63.., last);
    let other = foreign_token().await;
    let twice = studio(Method::GET, HEALTH)
        .header(SESSION_HEADER, &token)
        .header(SESSION_HEADER, &token)
        .body(Body::empty())
        .unwrap();
    let cases = [
        (
            "last character changed",
            studio_with(Method::GET, HEALTH, &last_changed),
        ),
        (
            "upper case",
            studio_with(Method::GET, HEALTH, &token.to_ascii_uppercase()),
        ),
        (
            "another app's token",
            studio_with(Method::GET, HEALTH, &other),
        ),
        ("empty", studio_with(Method::GET, HEALTH, "")),
        ("two headers", twice),
    ];
    for (case, request) in cases {
        let answer = send(&app, request).await;
        answer.assert_error(StatusCode::UNAUTHORIZED, "SessionInvalid", case);
        answer.assert_www_authenticate(case);
        answer.assert_cors(case);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn health_from_studio_with_the_token_elsewhere_than_its_header_is_401_session_required() {
    let (app, _) = reachable();
    let token = token(&app).await;
    let in_query = |name: &str| {
        studio(Method::GET, &format!("{HEALTH}?{name}={token}"))
            .body(Body::empty())
            .unwrap()
    };
    let cases = [
        ("?session=", in_query("session")),
        ("?token=", in_query("token")),
        ("?X-EmuForge-Session=", in_query("X-EmuForge-Session")),
        (
            "Authorization",
            studio(Method::GET, HEALTH)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "Cookie",
            studio(Method::GET, HEALTH)
                .header(COOKIE, format!("session={token}"))
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (case, request) in cases {
        let answer = send(&app, request).await;
        answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", case);
    }
}

/// `GET /__emuforge/health` with `origins` as its `Origin` headers and the token.
fn health_from(origins: &[HeaderValue], token: &str) -> Request<Body> {
    let mut builder = request(Method::GET, HEALTH).header(SESSION_HEADER, token);
    for origin in origins {
        builder = builder.header(ORIGIN, origin.clone());
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn health_from_a_foreign_origin_is_403_without_cors_or_probe() {
    let (app, calls) = reachable();
    let token = token(&app).await;
    let value = |text: &'static str| HeaderValue::from_static(text);
    let cases = [
        ("localhost", vec![value("http://localhost:8296")]),
        ("other port", vec![value("http://127.0.0.1:8100")]),
        ("https", vec![value("https://127.0.0.1:8296")]),
        ("null", vec![value("null")]),
        ("trailing slash", vec![value("http://127.0.0.1:8296/")]),
        ("with a path", vec![value("http://127.0.0.1:8296/x")]),
        (
            "byte 0x80",
            vec![HeaderValue::from_bytes(b"http://127.0.0.1:8296\x80").unwrap()],
        ),
        (
            "S and another origin",
            vec![value(S), value("https://example.com")],
        ),
        ("S twice", vec![value(S), value(S)]),
    ];
    for (case, origins) in cases {
        let answer = send(&app, health_from(&origins, &token)).await;
        answer.assert_error(StatusCode::FORBIDDEN, "OriginNotAllowed", case);
        answer.assert_no_cors(case);
        answer.assert_vary_origin(case);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn session_from_a_foreign_origin_is_403_without_cors_or_token() {
    let (app, _) = reachable();
    let token = token(&app).await;
    let answer = send(
        &app,
        request(Method::GET, SESSION)
            .header(ORIGIN, "https://example.com")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    answer.assert_error(StatusCode::FORBIDDEN, "OriginNotAllowed", "foreign session");
    answer.assert_no_cors("foreign session");
    answer.assert_no_token(&token, "foreign session");
}

#[tokio::test]
async fn preflight_from_a_foreign_origin_is_403_without_cors() {
    let (app, _) = reachable();
    let answer = send(&app, preflight(HEALTH, "https://example.com", "GET")).await;
    answer.assert_error(
        StatusCode::FORBIDDEN,
        "OriginNotAllowed",
        "foreign preflight",
    );
    answer.assert_no_cors("foreign preflight");
}

#[tokio::test]
async fn health_with_fetch_metadata_and_no_origin_is_403_without_cors_or_probe() {
    let (app, calls) = reachable();
    let cases = [
        ("Sec-Fetch-Site", "cross-site"),
        ("Sec-Fetch-Site", "none"),
        ("Sec-Fetch-Mode", "navigate"),
        ("Sec-Fetch-Dest", "image"),
    ];
    for (name, value) in cases {
        let case = format!("{name}: {value}");
        let answer = send(
            &app,
            request(Method::GET, HEALTH)
                .header(name, value)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        answer.assert_error(StatusCode::FORBIDDEN, "OriginNotAllowed", &case);
        answer.assert_no_cors(&case);
        answer.assert_vary_origin(&case);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn session_with_fetch_metadata_and_no_origin_is_403_without_token() {
    let (app, _) = reachable();
    let token = token(&app).await;
    let answer = send(
        &app,
        request(Method::GET, SESSION)
            .header("Sec-Fetch-Site", "cross-site")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    answer.assert_error(
        StatusCode::FORBIDDEN,
        "OriginNotAllowed",
        "Sec-Fetch session",
    );
    answer.assert_no_token(&token, "Sec-Fetch session");
}

#[tokio::test]
async fn health_from_a_local_tool_ignores_any_session_header() {
    let (app, _) = reachable();
    let cases = [
        ("absent", request(Method::GET, HEALTH)),
        (
            "wrong",
            request(Method::GET, HEALTH).header(SESSION_HEADER, "0".repeat(64)),
        ),
    ];
    for (case, builder) in cases {
        let answer = send(&app, builder.body(Body::empty()).unwrap()).await;
        assert_eq!(answer.status, StatusCode::OK, "case {case}");
        assert_eq!(
            answer.json(),
            health_body(&Health::Reachable),
            "case {case}"
        );
        answer.assert_no_cors(case);
        answer.assert_vary_origin(case);
    }
}

#[tokio::test]
async fn relayed_path_from_studio_with_token_is_relayed_with_cors() {
    let cases = [
        ("GET /", Method::GET, "/"),
        ("GET /bucket/key", Method::GET, "/bucket/key"),
        ("POST /bucket/key", Method::POST, "/bucket/key"),
    ];
    for (case, method, path) in cases {
        let (probe, _) = answering(vec![Health::Reachable]);
        let (relay, relayed) = test_relay();
        let app = app_relaying(probe, relay);
        let token = token(&app).await;
        let answer = send(&app, studio_with(method, path, &token)).await;
        assert_eq!(answer.status, StatusCode::OK, "case {case}: status");
        assert_eq!(answer.body, RELAYED.as_bytes(), "case {case}: body");
        answer.assert_cors(case);
        answer.assert_vary_studio(case);
        assert_eq!(
            relayed.load(Ordering::SeqCst),
            1,
            "case {case}: relay calls"
        );
    }
}

#[tokio::test]
async fn encoded_slash_path_from_studio_is_relayed_without_probe() {
    let (probe, probed) = answering(vec![Health::Reachable]);
    let (relay, relayed) = test_relay();
    let app = app_relaying(probe, relay);
    let token = token(&app).await;
    let answer = send(
        &app,
        studio_with(Method::GET, "/__emuforge%2Fhealth", &token),
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK, "%2F: status");
    assert_eq!(answer.body, RELAYED.as_bytes(), "%2F: body");
    assert_eq!(relayed.load(Ordering::SeqCst), 1, "%2F: relay calls");
    assert_eq!(probed.load(Ordering::SeqCst), 0, "%2F: probe calls");
}

#[tokio::test]
async fn preflight_from_studio_on_a_relayed_path_is_204_with_cors() {
    let (app, _) = reachable();
    let answer = send(&app, preflight("/", S, "GET")).await;
    assert_eq!(answer.status, StatusCode::NO_CONTENT, "preflight /: status");
    answer.assert_cors("preflight /");
    assert_eq!(
        answer.values(ACCESS_CONTROL_ALLOW_METHODS),
        ["GET, HEAD, PUT, POST, DELETE, PATCH"],
        "preflight /: Access-Control-Allow-Methods"
    );
}

#[tokio::test]
async fn relayed_path_with_fetch_metadata_and_no_origin_is_403_without_cors() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        request(Method::GET, "/")
            .header("Sec-Fetch-Site", "cross-site")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    answer.assert_aws_error(StatusCode::FORBIDDEN, "OriginNotAllowed", "Sec-Fetch /");
    answer.assert_no_cors("Sec-Fetch /");
    answer.assert_vary_origin("Sec-Fetch /");
}

#[tokio::test]
async fn relayed_path_from_a_local_tool_is_relayed_without_cors_or_vary() {
    let (probe, _) = answering(vec![Health::Reachable]);
    let (relay, relayed) = test_relay();
    let app = app_relaying(probe, relay);
    let answer = send(&app, request(Method::GET, "/").body(Body::empty()).unwrap()).await;
    assert_eq!(relayed.load(Ordering::SeqCst), 1, "GET /: relay calls");
    assert_eq!(answer.status, StatusCode::OK, "GET /: status");
    assert_eq!(answer.body, RELAYED.as_bytes(), "GET /: body");
    answer.assert_no_cors("GET /");
    assert!(!answer.headers.contains_key(VARY), "Vary on GET /");
}

#[tokio::test]
async fn missing_engine_path_from_studio_with_token_is_404_with_cors() {
    let (app, _) = reachable();
    let token = token(&app).await;
    for path in ["/__emuforge/missing", "/__emuforge"] {
        let answer = send(&app, studio_with(Method::GET, path, &token)).await;
        answer.assert_error(StatusCode::NOT_FOUND, "NotFound", path);
        answer.assert_cors(path);
    }
}

#[tokio::test]
async fn missing_engine_path_from_studio_without_token_is_401() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        studio(Method::GET, "/__emuforge/missing")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", "missing");
}

#[tokio::test]
async fn health_other_method_from_studio_without_token_is_401_not_405() {
    let (app, _) = reachable();
    for method in [Method::POST, Method::PUT, Method::DELETE] {
        let case = method.to_string();
        let answer = send(&app, studio(method, HEALTH).body(Body::empty()).unwrap()).await;
        answer.assert_error(StatusCode::UNAUTHORIZED, "SessionRequired", &case);
    }
}

#[tokio::test]
async fn health_post_from_studio_with_token_is_405_with_cors() {
    let (app, _) = reachable();
    let token = token(&app).await;
    let answer = send(&app, studio_with(Method::POST, HEALTH, &token)).await;
    answer.assert_error(StatusCode::METHOD_NOT_ALLOWED, "MethodNotAllowed", "POST");
    assert_eq!(answer.values(ALLOW), ["GET, HEAD"]);
    answer.assert_cors("POST");
}

#[tokio::test]
async fn session_from_studio_with_a_foreign_host_is_421_with_cors_and_no_token() {
    let (app, _) = reachable();
    let token = token(&app).await;
    for host in ["evil.example:8297", "localhost:8297"] {
        let answer = send(
            &app,
            Request::get(SESSION)
                .header(HOST, host)
                .header(ORIGIN, S)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        answer.assert_error(StatusCode::MISDIRECTED_REQUEST, "MisdirectedRequest", host);
        answer.assert_cors(host);
        answer.assert_no_token(&token, host);
    }
}

#[tokio::test]
async fn studio_request_with_a_foreign_host_is_421_varying_on_origin_and_the_session() {
    let (app, calls) = reachable();
    let token = token(&app).await;
    for host in ["evil.example:8297", "localhost:8297"] {
        let answer = send(
            &app,
            Request::get(HEALTH)
                .header(HOST, host)
                .header(ORIGIN, S)
                .header(SESSION_HEADER, &token)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        answer.assert_error(StatusCode::MISDIRECTED_REQUEST, "MisdirectedRequest", host);
        answer.assert_vary_studio(host);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn health_from_a_foreign_origin_with_a_foreign_host_is_421_without_cors() {
    let (app, _) = reachable();
    let answer = send(
        &app,
        Request::get(HEALTH)
            .header(HOST, "evil.example:8297")
            .header(ORIGIN, "https://example.com")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::MISDIRECTED_REQUEST);
    answer.assert_no_cors("foreign Host");
}

#[tokio::test]
async fn answers_keep_1s_shapes_and_only_the_session_200_carries_the_token() {
    let (app, _) = reachable();
    let session = send(
        &app,
        studio(Method::GET, SESSION).body(Body::empty()).unwrap(),
    )
    .await;
    let token = session.json()["token"].as_str().unwrap().to_owned();
    for (name, value) in &session.headers {
        assert!(
            !String::from_utf8_lossy(value.as_bytes()).contains(&token),
            "the token is in header {name} of the session answer"
        );
    }
    let preflight = send(&app, preflight(HEALTH, S, "GET")).await;
    assert!(preflight.body.is_empty());
    assert!(!preflight.headers.contains_key(CONTENT_TYPE));
    preflight.assert_no_token(&token, "preflight");
    let cases = [
        (
            "401",
            studio(Method::GET, HEALTH).body(Body::empty()).unwrap(),
        ),
        (
            "403",
            request(Method::GET, HEALTH)
                .header(ORIGIN, "https://example.com")
                .header(SESSION_HEADER, &token)
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (case, request) in cases {
        let answer = send(&app, request).await;
        assert_eq!(
            answer.headers[CONTENT_TYPE], "application/json",
            "case {case}"
        );
        let body = answer.json();
        let error = body["error"].as_object().unwrap();
        assert_eq!(body.as_object().unwrap().len(), 1, "case {case}: {body}");
        assert_eq!(error.len(), 2, "case {case}: {body}");
        assert!(
            error["code"].is_string() && error["message"].is_string(),
            "case {case}: {body}"
        );
        answer.assert_no_token(&token, case);
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
async fn refusals_never_read_the_request_body() {
    let (app, _) = reachable();
    let cases = [
        ("Studio POST session", SESSION, S, StatusCode::UNAUTHORIZED),
        (
            "foreign POST health",
            HEALTH,
            "https://example.com",
            StatusCode::FORBIDDEN,
        ),
    ];
    for (case, path, from, expected) in cases {
        let polled = Arc::new(AtomicBool::new(false));
        let body = Body::new(Tripwire(polled.clone()));
        let answer = send(
            &app,
            request(Method::POST, path)
                .header(ORIGIN, from)
                .body(body)
                .unwrap(),
        )
        .await;
        assert_eq!(answer.status, expected, "case {case}");
        assert!(!polled.load(Ordering::SeqCst), "case {case}: body polled");
    }
}

/// An `app` whose probe never answers, with `max_in_flight` health requests from a local tool held in it.
async fn full_app() -> (Router, Vec<tokio::task::JoinHandle<()>>, Arc<Notify>) {
    let release = Arc::new(Notify::new());
    let (entered_tx, mut entered) = mpsc::unbounded_channel();
    let held = release.clone();
    let probe: ProbeFn = Arc::new(move |_emulator| {
        let (held, entered) = (held.clone(), entered_tx.clone());
        Box::pin(async move {
            let released = held.notified();
            tokio::pin!(released);
            released.as_mut().enable();
            let _ = entered.send(());
            released.await;
            Health::Reachable
        })
    });
    let app = app_with(probe);
    let tasks = (0..2)
        .map(|_| {
            let app = app.clone();
            tokio::spawn(async move {
                let request = request(Method::GET, HEALTH).body(Body::empty()).unwrap();
                app.oneshot(request).await.unwrap();
            })
        })
        .collect();
    for _ in 0..2 {
        entered.recv().await.unwrap();
    }
    (app, tasks, release)
}

/// Sends one request that must answer without waiting on anything held.
async fn send_at_once(app: &Router, request: Request<Body>) -> Answer {
    tokio::time::timeout(Duration::from_secs(1), send(app, request))
        .await
        .expect("the request waited instead of answering at once")
}

#[tokio::test(start_paused = true)]
async fn studio_requests_past_the_limit_are_busy_with_cors() {
    let (app, _tasks, _release) = full_app().await;
    let cases = [
        (
            "session",
            studio(Method::GET, SESSION).body(Body::empty()).unwrap(),
        ),
        ("preflight", preflight(HEALTH, S, "GET")),
    ];
    for (case, request) in cases {
        let answer = send_at_once(&app, request).await;
        answer.assert_error(StatusCode::SERVICE_UNAVAILABLE, "Busy", case);
        answer.assert_cors(case);
        answer.assert_vary_studio(case);
    }
}

#[tokio::test(start_paused = true)]
async fn foreign_request_past_the_limit_is_busy_without_cors_with_vary() {
    let (app, _tasks, _release) = full_app().await;
    let answer = send_at_once(
        &app,
        request(Method::GET, "/")
            .header(ORIGIN, "https://example.com")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    answer.assert_aws_error(StatusCode::SERVICE_UNAVAILABLE, "Busy", "foreign /");
    answer.assert_no_cors("foreign /");
    answer.assert_vary_origin("foreign /");
}
