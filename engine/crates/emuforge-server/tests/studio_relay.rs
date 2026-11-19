#![cfg(test)]

//! The router as Studio's browser sees it on relayed paths (issue 10): the relayed-path preflight, the session
//! token on every relayed request, the browser headers removed before the relay, and the CORS headers of every
//! answer. Every answer sent through [`Harness::send`] is checked to carry no session token.

use std::io;
use std::num::NonZeroU16;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, ACCESS_CONTROL_MAX_AGE,
    ACCESS_CONTROL_REQUEST_HEADERS, ACCESS_CONTROL_REQUEST_METHOD, AUTHORIZATION, CONNECTION,
    CONTENT_TYPE, HOST, ORIGIN, VARY, WWW_AUTHENTICATE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, Uri};
use emuforge_core::{Health, Limits, Prepared, Reason, RelayError, Store, forward};
use emuforge_server::{
    AppState, Form, ProbeFn, RelayFn, SessionToken, StudioOrigin, app, seed_settings,
};
use hyper::body::{Bytes, Frame};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::{mpsc, oneshot};
use tower::ServiceExt;

/// The Studio origin of every `app` here.
const S: &str = "http://127.0.0.1:8296";
const ENGINE_HOST: &str = "127.0.0.1:8297";
const SESSION: &str = "/__emuforge/session";
const SESSION_HEADER: &str = "x-emuforge-session";
/// A key the emulator does not know, as Studio signs with.
const PLACEHOLDER_KEY: &str = "AKIAEMUFORGESTUDIO01";
const SIGNATURE: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const AMZ_DATE: &str = "20261115T000000Z";
const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const LIST_STATE_MACHINES: &str = "AWSStepFunctions.ListStateMachines";
const JSON_1_0: &str = "application/x-amz-json-1.0";
/// The SDK's preflight headers observed from Chromium (evidence §S.3).
const SDK_PREFLIGHT_HEADERS: &str = "amz-sdk-invocation-id,amz-sdk-request,authorization,content-type,x-amz-checksum-crc32,x-amz-content-sha256,x-amz-date,x-amz-sdk-checksum-algorithm,x-amz-user-agent,x-emuforge-session";
const SDK_INVOCATION_ID: &str = "2f5c1d1e-0b7a-4e7e-9b2d-7c1f5a3e9d10";
const SDK_USER_AGENT: &str = "aws-sdk-js/3.1161.0 ua/2.1 os/macOS lang/js md/browser#Chrome_158";
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36";

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

// ---- The seam ----

/// What the seam's stand-in answers.
#[derive(Clone)]
enum Script {
    /// Exactly this status line, these headers and this body; nothing is added.
    Fixed {
        status: u16,
        headers: Vec<(&'static str, String)>,
        body: Vec<u8>,
    },
    /// A chunked `200` whose head and first chunk are sent at once; the body ends when it is released.
    Held {
        releases: mpsc::UnboundedSender<oneshot::Sender<()>>,
    },
    Error(RelayError),
}

/// The body the seam answers by default.
const RELAYED: &str = "the seam's answer";

fn ok() -> Script {
    Script::Fixed {
        status: 200,
        headers: vec![
            ("content-type", "text/plain".to_owned()),
            ("content-length", RELAYED.len().to_string()),
        ],
        body: RELAYED.as_bytes().to_vec(),
    }
}

/// The request head the seam was handed.
#[derive(Debug, Clone)]
struct Seen {
    method: Method,
    uri: Uri,
    headers: HeaderMap,
}

/// The `RelayFn` of the `app`: records the head of each request it is handed and answers by its script through
/// `emuforge_core::forward` over a duplex stream to a stand-in.
struct Seam {
    relay: RelayFn,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Seam {
    fn answering(script: Script) -> Seam {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let relay: RelayFn = Arc::new(move |_emulator, request: Request<Body>| {
            record.lock().unwrap().push(Seen {
                method: request.method().clone(),
                uri: request.uri().clone(),
                headers: request.headers().clone(),
            });
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
                    &Limits::DEFAULT,
                )
                .await
            })
        });
        Seam { relay, seen }
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }

    fn calls(&self) -> usize {
        self.seen.lock().unwrap().len()
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
            answer.push_str("\r\n");
            let mut bytes = answer.into_bytes();
            if !head_only {
                bytes.extend_from_slice(&body);
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
            let _ = stream.read(&mut byte).await;
        }
        Script::Error(_) => {}
    }
}

// ---- The app ----

/// A probe that answers reachable and counts its calls.
fn counted_probe() -> (ProbeFn, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let probe: ProbeFn = Arc::new(move |_emulator| {
        counter.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Health::Reachable })
    });
    (probe, calls)
}

/// A store whose folder does not exist: every load is the seed, `local` at `https://127.0.0.1:9391`.
fn absent_settings() -> Arc<Store> {
    Arc::new(Store::new(
        PathBuf::from("/h/.config/emuforge"),
        seed_settings(Form::Native, NonZeroU16::new(9391).unwrap()),
    ))
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
        session: Arc::new(SessionToken::generate().unwrap()),
    })
}

/// An `app` with Studio origin S, engine port 8297, `max_in_flight` 2, the seam, and T.
struct Harness {
    app: Router,
    seam: Seam,
    probed: Arc<AtomicUsize>,
    token: String,
}

impl Harness {
    async fn new(script: Script) -> Harness {
        let seam = Seam::answering(script);
        let (probe, probed) = counted_probe();
        let app = app_relaying(probe, seam.relay.clone());
        let token = session_token(&app).await;
        Harness {
            app,
            seam,
            probed,
            token,
        }
    }

    async fn relaying_ok() -> Harness {
        Harness::new(ok()).await
    }

    /// Sends `request` and checks that the answer carries T nowhere.
    async fn send(&self, request: Request<Body>, case: &str) -> Answer {
        let answer = read(self.app.clone().oneshot(request).await.unwrap()).await;
        answer.assert_no_token(&self.token, case);
        answer
    }

    fn assert_untouched(&self, case: &str) {
        assert_eq!(self.seam.calls(), 0, "case {case}: seam calls");
        assert_eq!(
            self.probed.load(Ordering::SeqCst),
            0,
            "case {case}: probe calls"
        );
    }
}

/// The token, obtained as Studio obtains it.
async fn session_token(app: &Router) -> String {
    let request = request(Method::GET, SESSION)
        .header(ORIGIN, S)
        .body(Body::empty())
        .unwrap();
    let answer = read(app.clone().oneshot(request).await.unwrap()).await;
    assert_eq!(answer.status, StatusCode::OK, "session");
    answer.json()["token"].as_str().unwrap().to_owned()
}

/// A 64-hex token of another `app`.
async fn foreign_token() -> String {
    let (probe, _) = counted_probe();
    session_token(&app_relaying(probe, Seam::answering(ok()).relay)).await
}

// ---- Requests ----

fn request(method: Method, target: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(target)
        .header(HOST, ENGINE_HOST)
}

fn empty(builder: axum::http::request::Builder) -> Request<Body> {
    builder.body(Body::empty()).unwrap()
}

/// `method target` header-signed for `service` with a key the emulator does not know, `x-emuforge-session`
/// among its signed headers.
fn signed(method: Method, target: &str, service: &str) -> axum::http::request::Builder {
    request(method, target)
        .header(
            AUTHORIZATION,
            format!(
                "AWS4-HMAC-SHA256 Credential={PLACEHOLDER_KEY}/20261115/us-east-1/{service}/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-emuforge-session, Signature={SIGNATURE}"
            ),
        )
        .header("x-amz-date", AMZ_DATE)
        .header("x-amz-content-sha256", EMPTY_SHA256)
}

/// The headers the browser adds to every request from S.
fn browser_headers(builder: axum::http::request::Builder) -> axum::http::request::Builder {
    builder
        .header(ORIGIN, S)
        .header("sec-fetch-site", "same-site")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-dest", "empty")
}

/// `method target` in the Studio form without the session header.
fn studio_form_without_token(
    method: Method,
    target: &str,
    service: &str,
) -> axum::http::request::Builder {
    browser_headers(signed(method, target, service))
        .header(
            "sec-ch-ua",
            "\"Chromium\";v=\"158\", \"Not-A.Brand\";v=\"24\"",
        )
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"macOS\"")
        .header("user-agent", BROWSER_USER_AGENT)
        .header("accept-encoding", "gzip, deflate, br, zstd")
}

/// `method target` in the Studio form with `token`.
fn studio_form(
    method: Method,
    target: &str,
    service: &str,
    token: &str,
) -> axum::http::request::Builder {
    studio_form_without_token(method, target, service).header(SESSION_HEADER, token)
}

fn list_buckets(token: &str) -> Request<Body> {
    empty(studio_form(Method::GET, "/?x-id=ListBuckets", "s3", token))
}

/// A preflight from `from` on `path` asking for `method` with the SDK's preflight headers.
fn sdk_preflight(path: &str, from: &str, method: &str) -> axum::http::request::Builder {
    request(Method::OPTIONS, path)
        .header(ORIGIN, from)
        .header(ACCESS_CONTROL_REQUEST_METHOD, method)
        .header(ACCESS_CONTROL_REQUEST_HEADERS, SDK_PREFLIGHT_HEADERS)
        .header("sec-fetch-site", "same-site")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-dest", "empty")
        .header("user-agent", BROWSER_USER_AGENT)
}

/// A preflight from S on `/` asking for `GET`, without `Access-Control-Request-Headers`.
fn bare_preflight() -> axum::http::request::Builder {
    request(Method::OPTIONS, "/")
        .header(ORIGIN, S)
        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET")
}

// ---- Answers ----

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

async fn read(response: axum::response::Response) -> Answer {
    let (parts, body) = response.into_parts();
    let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    Answer {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.to_vec()).unwrap()
    }

    fn values(&self, name: impl axum::http::header::AsHeaderName) -> Vec<&str> {
        self.headers
            .get_all(name)
            .iter()
            .map(|value| value.to_str().unwrap())
            .collect()
    }

    /// The one `Access-Control-Expose-Headers` value split into names, or no names when it is absent.
    fn exposed(&self, case: &str) -> Vec<&str> {
        match self.values(ACCESS_CONTROL_EXPOSE_HEADERS).as_slice() {
            [] => Vec::new(),
            [list] => list.split(", ").collect(),
            several => panic!("case {case}: Access-Control-Expose-Headers {several:?}"),
        }
    }

    fn assert_exposes(&self, names: &[&str], case: &str) {
        let exposed = self.exposed(case);
        for name in names {
            assert!(
                exposed.contains(name),
                "case {case}: {name} not in Access-Control-Expose-Headers {exposed:?}"
            );
        }
    }

    /// Exactly one `Access-Control-Allow-Origin: S`, and no `Access-Control-Allow-Credentials`.
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

    fn assert_no_cors(&self, case: &str) {
        for name in self.headers.keys() {
            assert!(
                !name.as_str().starts_with("access-control-"),
                "case {case}: {name}"
            );
        }
    }

    /// An answer to the Studio origin with no `Vary` of the upstream's: `Vary` is `Origin` and
    /// `X-EmuForge-Session`, one line each (issue 24 D2).
    fn assert_vary_studio(&self, case: &str) {
        assert_eq!(
            self.values(VARY),
            ["Origin", "X-EmuForge-Session"],
            "case {case}: Vary"
        );
    }

    /// An error in S3's XML shape with `code`.
    fn assert_s3_error(&self, status: StatusCode, code: &str, case: &str) {
        assert_eq!(self.status, status, "case {case}: status");
        assert_eq!(
            self.values(CONTENT_TYPE),
            ["application/xml"],
            "case {case}: Content-Type"
        );
        assert!(
            self.text().contains(&format!("<Code>{code}</Code>")),
            "case {case}: body {}",
            self.text()
        );
    }

    /// An error in the JSON or REST-JSON shape with `code`: `x-amzn-ErrorType` and `__type`.
    fn assert_json_error(&self, status: StatusCode, code: &str, case: &str) {
        assert_eq!(self.status, status, "case {case}: status");
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

// ---- The relayed-path preflight ----

/// The relayed-path preflight answer, with `allow_headers` as its `Access-Control-Allow-Headers`.
fn assert_relayed_preflight(answer: &Answer, allow_headers: Option<&str>, case: &str) {
    assert_eq!(answer.status, StatusCode::NO_CONTENT, "case {case}: status");
    assert!(answer.body.is_empty(), "case {case}: body");
    answer.assert_cors(case);
    assert_eq!(
        answer.values(ACCESS_CONTROL_ALLOW_METHODS),
        ["GET, HEAD, PUT, POST, DELETE, PATCH"],
        "case {case}: Access-Control-Allow-Methods"
    );
    let expected: Vec<&str> = allow_headers.into_iter().collect();
    assert_eq!(
        answer.values(ACCESS_CONTROL_ALLOW_HEADERS),
        expected,
        "case {case}: Access-Control-Allow-Headers"
    );
    assert_eq!(
        answer.values(ACCESS_CONTROL_MAX_AGE),
        ["600"],
        "case {case}: Access-Control-Max-Age"
    );
    answer.assert_vary_studio(case);
    assert!(
        !answer.headers.contains_key(ACCESS_CONTROL_EXPOSE_HEADERS),
        "case {case}: Access-Control-Expose-Headers"
    );
}

#[tokio::test]
async fn relayed_preflight_from_studio_with_sdk_headers_is_204_without_relay_or_probe() {
    let cases = [
        ("OPTIONS /", "/"),
        (
            "OPTIONS /bucket/key?x-id=PutObject",
            "/bucket/key?x-id=PutObject",
        ),
    ];
    for (case, target) in cases {
        let harness = Harness::relaying_ok().await;
        let answer = harness
            .send(empty(sdk_preflight(target, S, "PUT")), case)
            .await;
        assert_relayed_preflight(&answer, Some(SDK_PREFLIGHT_HEADERS), case);
        harness.assert_untouched(case);
    }
}

#[tokio::test]
async fn relayed_preflight_for_any_method_or_with_a_wrong_token_is_the_same_204() {
    let harness = Harness::relaying_ok().await;
    let wrong = foreign_token().await;
    let cases = [
        ("GET", empty(sdk_preflight("/", S, "GET"))),
        ("POST", empty(sdk_preflight("/", S, "POST"))),
        ("DELETE", empty(sdk_preflight("/", S, "DELETE"))),
        (
            "wrong token",
            empty(sdk_preflight("/", S, "PUT").header(SESSION_HEADER, &wrong)),
        ),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        assert_relayed_preflight(&answer, Some(SDK_PREFLIGHT_HEADERS), case);
    }
    harness.assert_untouched("all");
}

#[tokio::test]
async fn relayed_preflight_repeats_a_valid_header_list_byte_for_byte() {
    let harness = Harness::relaying_ok().await;
    let cases = [
        ("x-emuforge-session", "x-emuforge-session"),
        ("spaced", "x-a, x-b"),
        ("space and tab", "x-a ,\tx-b"),
    ];
    for (case, list) in cases {
        let request = empty(bare_preflight().header(ACCESS_CONTROL_REQUEST_HEADERS, list));
        let answer = harness.send(request, case).await;
        assert_relayed_preflight(&answer, Some(list), case);
    }
}

#[tokio::test]
async fn relayed_preflight_without_a_valid_header_list_allows_no_headers() {
    let harness = Harness::relaying_ok().await;
    let with = |list: &str| empty(bare_preflight().header(ACCESS_CONTROL_REQUEST_HEADERS, list));
    let cases = [
        ("absent", empty(bare_preflight())),
        ("empty", with("")),
        ("empty element", with("x-a,,x-b")),
        ("space inside", with("x a")),
        ("semicolon", with("x-a;x-b")),
        ("parentheses", with("(x)")),
        (
            "two headers",
            empty(
                bare_preflight()
                    .header(ACCESS_CONTROL_REQUEST_HEADERS, "x-a")
                    .header(ACCESS_CONTROL_REQUEST_HEADERS, "x-b"),
            ),
        ),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        assert_relayed_preflight(&answer, None, case);
    }
}

#[tokio::test]
async fn relayed_preflight_from_a_foreign_origin_is_403_without_cors_or_relay() {
    let harness = Harness::relaying_ok().await;
    for from in ["http://127.0.0.1:8100", "https://example.com", "null"] {
        let answer = harness
            .send(empty(sdk_preflight("/", from, "PUT")), from)
            .await;
        answer.assert_json_error(StatusCode::FORBIDDEN, "OriginNotAllowed", from);
        answer.assert_no_cors(from);
    }
    harness.assert_untouched("foreign");
}

#[tokio::test]
async fn relayed_preflight_from_studio_with_a_foreign_host_is_421_with_cors_without_relay() {
    let harness = Harness::relaying_ok().await;
    let mut request = empty(sdk_preflight("/", S, "PUT"));
    request
        .headers_mut()
        .insert(HOST, HeaderValue::from_static("evil.example:8297"));
    let answer = harness.send(request, "foreign Host").await;
    answer.assert_json_error(
        StatusCode::MISDIRECTED_REQUEST,
        "MisdirectedRequest",
        "foreign Host",
    );
    answer.assert_cors("foreign Host");
    harness.assert_untouched("foreign Host");
}

#[tokio::test]
async fn relayed_preflight_never_reads_the_request_body() {
    let harness = Harness::relaying_ok().await;
    let polled = Arc::new(AtomicBool::new(false));
    let request = sdk_preflight("/bucket/key", S, "PUT")
        .body(Body::new(Tripwire(polled.clone())))
        .unwrap();
    let answer = harness.send(request, "preflight with body").await;
    assert_eq!(answer.status, StatusCode::NO_CONTENT);
    assert!(!polled.load(Ordering::SeqCst), "the body was polled");
}

#[tokio::test]
async fn relayed_preflight_twice_is_answered_the_same() {
    let harness = Harness::relaying_ok().await;
    let first = harness
        .send(empty(sdk_preflight("/", S, "PUT")), "first")
        .await;
    let second = harness
        .send(empty(sdk_preflight("/", S, "PUT")), "second")
        .await;
    assert_eq!(first.status, second.status);
    assert_eq!(first.headers, second.headers);
}

// ---- The session token on relayed paths ----

#[tokio::test]
async fn relayed_request_from_studio_without_token_is_401_session_required_without_relay() {
    let harness = Harness::relaying_ok().await;
    let cases = [
        (
            "GET /?x-id=ListBuckets signed for s3",
            empty(studio_form_without_token(
                Method::GET,
                "/?x-id=ListBuckets",
                "s3",
            )),
        ),
        (
            "PUT /bucket/key",
            empty(browser_headers(request(Method::PUT, "/bucket/key"))),
        ),
        (
            "POST / ListStateMachines",
            empty(
                studio_form_without_token(Method::POST, "/", "states")
                    .header("x-amz-target", LIST_STATE_MACHINES)
                    .header(CONTENT_TYPE, JSON_1_0),
            ),
        ),
        (
            "DELETE /bucket/key",
            empty(browser_headers(request(Method::DELETE, "/bucket/key"))),
        ),
        (
            "OPTIONS /bucket/key without Access-Control-Request-Method",
            empty(browser_headers(request(Method::OPTIONS, "/bucket/key"))),
        ),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        if case.starts_with("GET") {
            answer.assert_s3_error(StatusCode::UNAUTHORIZED, "SessionRequired", case);
        } else {
            answer.assert_json_error(StatusCode::UNAUTHORIZED, "SessionRequired", case);
        }
        answer.assert_www_authenticate(case);
        answer.assert_cors(case);
        answer.assert_vary_studio(case);
        answer.assert_exposes(&["www-authenticate"], case);
        if case.starts_with("POST") {
            assert_eq!(
                answer.values(CONTENT_TYPE),
                [JSON_1_0],
                "case {case}: Content-Type"
            );
            answer.assert_exposes(&["x-amzn-errortype"], case);
        }
    }
    harness.assert_untouched("no token");
}

#[tokio::test]
async fn relayed_request_from_studio_with_another_token_is_401_session_invalid_without_relay() {
    let harness = Harness::relaying_ok().await;
    let token = harness.token.clone();
    let mut changed = token.clone();
    let last = changed.pop().unwrap();
    changed.push(if last == '0' { '1' } else { '0' });
    let foreign = foreign_token().await;
    let cases = [
        ("last character changed", list_buckets(&changed)),
        ("another app's token", list_buckets(&foreign)),
        ("empty", list_buckets("")),
        (
            "T twice",
            empty(
                studio_form(Method::GET, "/?x-id=ListBuckets", "s3", &token)
                    .header(SESSION_HEADER, &token),
            ),
        ),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        answer.assert_s3_error(StatusCode::UNAUTHORIZED, "SessionInvalid", case);
        answer.assert_www_authenticate(case);
        answer.assert_cors(case);
    }
    harness.assert_untouched("another token");
}

#[tokio::test]
async fn relayed_request_from_studio_with_another_token_is_401_varying_on_the_session() {
    let harness = Harness::relaying_ok().await;
    let foreign = foreign_token().await;
    let zeros = "0".repeat(64);
    let cases = [
        (
            "another app's token, GET /bucket/key",
            empty(studio_form(Method::GET, "/bucket/key", "s3", &foreign)),
        ),
        (
            "64 zeros, GET /bucket/key",
            empty(studio_form(Method::GET, "/bucket/key", "s3", &zeros)),
        ),
        ("another app's token, ListBuckets", list_buckets(&foreign)),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        answer.assert_s3_error(StatusCode::UNAUTHORIZED, "SessionInvalid", case);
        answer.assert_www_authenticate(case);
        answer.assert_cors(case);
        answer.assert_vary_studio(case);
    }
    harness.assert_untouched("another token");
}

#[tokio::test]
async fn relayed_request_with_the_token_only_in_the_query_is_401_session_required() {
    let harness = Harness::relaying_ok().await;
    let target = format!("/?x-id=ListBuckets&X-EmuForge-Session={}", harness.token);
    let answer = harness
        .send(
            empty(browser_headers(request(Method::GET, &target))),
            "query",
        )
        .await;
    answer.assert_json_error(StatusCode::UNAUTHORIZED, "SessionRequired", "query");
    assert_eq!(harness.seam.calls(), 0, "seam calls");
}

#[tokio::test]
async fn relayed_upload_from_studio_without_token_never_reads_the_body() {
    let harness = Harness::relaying_ok().await;
    let polled = Arc::new(AtomicBool::new(false));
    let request = browser_headers(request(Method::PUT, "/bucket/key"))
        .body(Body::new(Tripwire(polled.clone())))
        .unwrap();
    let answer = harness.send(request, "PUT without token").await;
    assert_eq!(answer.status, StatusCode::UNAUTHORIZED);
    assert!(!polled.load(Ordering::SeqCst), "the body was polled");
}

// ---- What the relay is handed ----

fn is_browser_header(name: &HeaderName) -> bool {
    let name = name.as_str();
    name == "origin" || name == SESSION_HEADER || name.starts_with("sec-fetch-")
}

/// `sent` without `Origin`, every `Sec-Fetch-*` and `X-EmuForge-Session`.
fn without_browser_headers(sent: &HeaderMap) -> HeaderMap {
    let mut kept = HeaderMap::new();
    for (name, value) in sent {
        if !is_browser_header(name) {
            kept.append(name.clone(), value.clone());
        }
    }
    kept
}

#[tokio::test]
async fn studio_request_reaches_the_relay_without_the_browser_headers() {
    let harness = Harness::relaying_ok().await;
    let request = empty(
        studio_form(Method::GET, "/?x-id=ListBuckets", "s3", &harness.token)
            .header("referer", "http://127.0.0.1:8296/s3/buckets")
            .header("amz-sdk-invocation-id", SDK_INVOCATION_ID)
            .header("x-amz-user-agent", SDK_USER_AGENT)
            .header("sec-fetch-site", "cross-site"),
    );
    let sent = request.headers().clone();
    let answer = harness.send(request, "Studio form").await;
    assert_eq!(answer.status, StatusCode::OK);
    let seen = harness.seam.seen();
    assert_eq!(seen.len(), 1, "seam calls");
    let seen = &seen[0];
    assert_eq!(seen.method, Method::GET);
    assert_eq!(seen.uri.path(), "/");
    assert_eq!(seen.uri.query(), Some("x-id=ListBuckets"));
    for name in seen.headers.keys() {
        assert!(!is_browser_header(name), "{name} reached the relay");
    }
    assert_eq!(seen.headers, without_browser_headers(&sent));
}

#[tokio::test]
async fn presigned_and_unsigned_studio_requests_reach_the_relay_with_their_auth_unchanged() {
    let presigned = "/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEMUFORGESTUDIO01%2F20261115%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261115T000000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=0000000000000000000000000000000000000000000000000000000000000000";
    let cases = [
        ("presigned GET", Method::GET, presigned, None),
        (
            "unsigned POST /",
            Method::POST,
            "/",
            Some(LIST_STATE_MACHINES),
        ),
    ];
    for (case, method, target, amz_target) in cases {
        let harness = Harness::relaying_ok().await;
        let mut builder =
            browser_headers(request(method.clone(), target)).header(SESSION_HEADER, &harness.token);
        if let Some(amz_target) = amz_target {
            builder = builder
                .header("x-amz-target", amz_target)
                .header(CONTENT_TYPE, JSON_1_0);
        }
        let answer = harness.send(empty(builder), case).await;
        assert_eq!(answer.status, StatusCode::OK, "case {case}: status");
        let seen = harness.seam.seen();
        assert_eq!(seen.len(), 1, "case {case}: seam calls");
        let seen = &seen[0];
        assert_eq!(seen.method, method, "case {case}: method");
        assert_eq!(seen.uri.to_string(), target, "case {case}: path and query");
        assert!(
            !seen.headers.contains_key(AUTHORIZATION),
            "case {case}: Authorization"
        );
        for name in seen.headers.keys() {
            assert!(!is_browser_header(name), "case {case}: {name}");
        }
    }
}

#[tokio::test]
async fn studio_request_sent_twice_is_relayed_twice() {
    let harness = Harness::relaying_ok().await;
    for case in ["first", "second"] {
        let answer = harness.send(list_buckets(&harness.token), case).await;
        assert_eq!(answer.status, StatusCode::OK, "case {case}");
    }
    assert_eq!(harness.seam.calls(), 2);
}

// ---- CORS on relayed answers ----

#[tokio::test]
async fn relayed_answer_to_studio_keeps_its_headers_and_exposes_them() {
    let body = b"<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>";
    let headers = vec![
        ("Content-Type", "application/xml".to_owned()),
        ("ETag", "\"e1\"".to_owned()),
        ("Last-Modified", "Sun, 15 Nov 2026 00:00:00 GMT".to_owned()),
        ("x-amz-request-id", "4442587FB7D0A2F9".to_owned()),
        (
            "x-amz-id-2",
            "vlR7PnpV2Ce81l0PRw6jlUpck7Jo5ZsQjryTjKlc5aLWGVHPZLj5NeC6qMa0emYBDXOo6QBU0Wo="
                .to_owned(),
        ),
        ("x-amz-meta-a", "one".to_owned()),
        ("x-amz-meta-a", "two".to_owned()),
        ("Content-Length", body.len().to_string()),
    ];
    let harness = Harness::new(Script::Fixed {
        status: 200,
        headers: headers.clone(),
        body: body.to_vec(),
    })
    .await;
    let answer = harness.send(list_buckets(&harness.token), "relayed").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, &body[..]);
    for (name, value) in &headers {
        assert!(
            answer.values(*name).contains(&value.as_str()),
            "{name}: {value} not in {:?}",
            answer.values(*name)
        );
    }
    assert_eq!(answer.values("x-amz-meta-a"), ["one", "two"]);
    answer.assert_cors("relayed");
    assert_eq!(
        answer.values(ACCESS_CONTROL_EXPOSE_HEADERS),
        [
            "content-length, content-type, etag, last-modified, x-amz-id-2, x-amz-meta-a, x-amz-request-id"
        ]
    );
    answer.assert_vary_studio("relayed");
}

#[tokio::test]
async fn relayed_answer_vary_gains_origin_and_is_not_exposed() {
    let harness = Harness::new(Script::Fixed {
        status: 200,
        headers: vec![
            ("Vary", "Accept-Encoding".to_owned()),
            ("Content-Length", RELAYED.len().to_string()),
        ],
        body: RELAYED.as_bytes().to_vec(),
    })
    .await;
    let answer = harness.send(list_buckets(&harness.token), "Vary").await;
    assert_eq!(
        answer.values(VARY),
        ["Accept-Encoding", "Origin", "X-EmuForge-Session"]
    );
    assert!(!answer.exposed("Vary").contains(&"vary"));
}

#[tokio::test]
async fn relayed_answer_to_studio_keeps_its_cache_headers_byte_for_byte_and_exposes_them() {
    let cache_headers = [
        ("Cache-Control", "max-age=3600"),
        ("Expires", "Mon, 16 Nov 2026 10:24:15 GMT"),
        ("Last-Modified", "Sun, 15 Nov 2026 10:24:15 GMT"),
        ("ETag", "\"5eb63bbbe01eeed093cb22bb8f5acdc3\""),
    ];
    let body = b"hello world";
    let mut headers: Vec<(&'static str, String)> = cache_headers
        .iter()
        .map(|(name, value)| (*name, (*value).to_owned()))
        .collect();
    headers.push(("Content-Length", body.len().to_string()));
    let harness = Harness::new(Script::Fixed {
        status: 200,
        headers,
        body: body.to_vec(),
    })
    .await;
    let answer = harness
        .send(
            empty(studio_form(
                Method::GET,
                "/bucket/key",
                "s3",
                &harness.token,
            )),
            "cache headers",
        )
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, &body[..]);
    for (name, value) in cache_headers {
        let sent: Vec<&[u8]> = answer
            .headers
            .get_all(name)
            .iter()
            .map(HeaderValue::as_bytes)
            .collect();
        assert_eq!(sent, [value.as_bytes()], "{name}");
    }
    answer.assert_cors("cache headers");
    answer.assert_exposes(
        &["cache-control", "etag", "expires", "last-modified"],
        "cache headers",
    );
}

/// An answer with `Access-Control-*` headers of its own, as an upstream might send.
fn upstream_cors() -> Script {
    Script::Fixed {
        status: 200,
        headers: vec![
            ("Access-Control-Allow-Origin", "*".to_owned()),
            ("Access-Control-Allow-Credentials", "true".to_owned()),
            ("Access-Control-Expose-Headers", "x-other".to_owned()),
            ("Content-Type", "text/plain".to_owned()),
            ("Content-Length", RELAYED.len().to_string()),
        ],
        body: RELAYED.as_bytes().to_vec(),
    }
}

#[tokio::test]
async fn relayed_answer_to_studio_replaces_upstream_cors_headers() {
    let harness = Harness::new(upstream_cors()).await;
    let answer = harness.send(list_buckets(&harness.token), "upstream").await;
    answer.assert_cors("upstream");
    assert_eq!(
        answer.values(ACCESS_CONTROL_EXPOSE_HEADERS),
        ["content-length, content-type"]
    );
}

#[tokio::test]
async fn relayed_answer_to_a_local_tool_keeps_upstream_headers_exactly() {
    let harness = Harness::new(upstream_cors()).await;
    let answer = harness
        .send(
            empty(signed(Method::GET, "/?x-id=ListBuckets", "s3")),
            "local tool",
        )
        .await;
    let mut expected = HeaderMap::new();
    for (name, value) in [
        ("access-control-allow-origin", "*".to_owned()),
        ("access-control-allow-credentials", "true".to_owned()),
        ("access-control-expose-headers", "x-other".to_owned()),
        ("content-type", "text/plain".to_owned()),
        ("content-length", RELAYED.len().to_string()),
    ] {
        expected.append(
            HeaderName::from_static(name),
            HeaderValue::try_from(value).unwrap(),
        );
    }
    assert_eq!(answer.headers, expected);
    assert!(!answer.headers.contains_key(VARY));
}

#[tokio::test]
async fn relayed_204_without_headers_to_studio_exposes_nothing() {
    let harness = Harness::new(Script::Fixed {
        status: 204,
        headers: Vec::new(),
        body: Vec::new(),
    })
    .await;
    let answer = harness.send(list_buckets(&harness.token), "204").await;
    assert_eq!(answer.status, StatusCode::NO_CONTENT);
    answer.assert_cors("204");
    answer.assert_vary_studio("204");
    assert!(
        !answer.headers.contains_key(ACCESS_CONTROL_EXPOSE_HEADERS),
        "{:?}",
        answer.headers
    );
}

#[tokio::test]
async fn relayed_501_to_studio_passes_unchanged_with_cors() {
    let body = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Error><Code>NotImplemented</Code><Message>A header you provided implies functionality that is not implemented</Message></Error>";
    let harness = Harness::new(Script::Fixed {
        status: 501,
        headers: vec![
            ("Content-Type", "application/xml".to_owned()),
            ("Content-Length", body.len().to_string()),
        ],
        body: body.to_vec(),
    })
    .await;
    let answer = harness
        .send(
            empty(studio_form(
                Method::GET,
                "/bucket?metadataTable=",
                "s3",
                &harness.token,
            )),
            "501",
        )
        .await;
    assert_eq!(answer.status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(answer.body, &body[..]);
    answer.assert_cors("501");
    assert_eq!(
        answer.values(ACCESS_CONTROL_EXPOSE_HEADERS),
        ["content-length, content-type"]
    );
}

#[tokio::test]
async fn relayed_head_to_studio_has_headers_without_body() {
    let harness = Harness::new(Script::Fixed {
        status: 200,
        headers: vec![
            ("ETag", "\"5eb63bbbe01eeed093cb22bb8f5acdc3\"".to_owned()),
            ("Content-Length", "11".to_owned()),
        ],
        body: b"hello world".to_vec(),
    })
    .await;
    let answer = harness
        .send(
            empty(studio_form(
                Method::HEAD,
                "/bucket/key",
                "s3",
                &harness.token,
            )),
            "HEAD",
        )
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert!(answer.body.is_empty());
    assert_eq!(
        answer.values("etag"),
        ["\"5eb63bbbe01eeed093cb22bb8f5acdc3\""]
    );
    assert_eq!(answer.values("content-length"), ["11"]);
    answer.assert_cors("HEAD");
    assert_eq!(
        answer.values(ACCESS_CONTROL_EXPOSE_HEADERS),
        ["content-length, etag"]
    );
}

// ---- Engine answers on relayed paths ----

#[tokio::test]
async fn relay_unavailable_for_studio_is_503_readable() {
    let harness = Harness::new(Script::Error(RelayError::Unavailable(Reason::NotStarted))).await;
    let answer = harness
        .send(list_buckets(&harness.token), "not started")
        .await;
    answer.assert_s3_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "EmulatorUnavailable",
        "not started",
    );
    answer.assert_cors("not started");
    answer.assert_exposes(&["content-type"], "not started");
    answer.assert_vary_studio("not started");
}

#[tokio::test]
async fn relay_client_stalled_for_studio_is_408_readable_and_closing() {
    let harness = Harness::new(Script::Error(RelayError::ClientStalled)).await;
    let answer = harness
        .send(
            empty(studio_form(
                Method::PUT,
                "/bucket/key",
                "s3",
                &harness.token,
            )),
            "stalled",
        )
        .await;
    answer.assert_s3_error(StatusCode::REQUEST_TIMEOUT, "RequestTimeout", "stalled");
    assert_eq!(answer.values(CONNECTION), ["close"]);
    answer.assert_cors("stalled");
    answer.assert_exposes(&["connection", "content-type"], "stalled");
}

#[tokio::test]
async fn studio_request_with_a_foreign_host_is_421_in_s3_xml_with_cors() {
    let harness = Harness::relaying_ok().await;
    let mut request = list_buckets(&harness.token);
    request
        .headers_mut()
        .insert(HOST, HeaderValue::from_static("evil.example:8297"));
    let answer = harness.send(request, "foreign Host").await;
    answer.assert_s3_error(
        StatusCode::MISDIRECTED_REQUEST,
        "MisdirectedRequest",
        "foreign Host",
    );
    answer.assert_cors("foreign Host");
    assert_eq!(harness.seam.calls(), 0, "seam calls");
}

#[tokio::test(start_paused = true)]
async fn studio_requests_past_the_limit_are_busy_with_cors() {
    let (releases_tx, mut releases) = mpsc::unbounded_channel();
    let harness = Harness::new(Script::Held {
        releases: releases_tx,
    })
    .await;
    let mut held = Vec::new();
    for path in ["/b/1", "/b/2"] {
        let response = harness
            .app
            .clone()
            .oneshot(empty(request(Method::GET, path)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "held {path}");
        held.push((response, releases.recv().await.unwrap()));
    }
    let cases = [
        ("Studio GET", list_buckets(&harness.token)),
        ("Studio preflight", empty(sdk_preflight("/", S, "PUT"))),
    ];
    for (case, request) in cases {
        let answer = tokio::time::timeout(Duration::from_secs(1), harness.send(request, case))
            .await
            .expect("the request waited instead of answering at once");
        if case == "Studio GET" {
            answer.assert_s3_error(StatusCode::SERVICE_UNAVAILABLE, "Busy", case);
        } else {
            answer.assert_json_error(StatusCode::SERVICE_UNAVAILABLE, "Busy", case);
        }
        answer.assert_cors(case);
    }
    assert_eq!(harness.seam.calls(), 2, "seam calls");
}

// ---- The token in answers ----

#[tokio::test]
async fn answers_on_relayed_paths_never_carry_the_token() {
    let harness = Harness::relaying_ok().await;
    let token = harness.token.clone();
    let cases = [
        ("preflight", empty(sdk_preflight("/", S, "PUT"))),
        (
            "401 SessionRequired",
            empty(studio_form_without_token(
                Method::GET,
                "/?x-id=ListBuckets",
                "s3",
            )),
        ),
        ("401 SessionInvalid", list_buckets(&foreign_token().await)),
        ("relayed", list_buckets(&token)),
        (
            "403 foreign origin with the token",
            empty(
                request(Method::GET, "/")
                    .header(ORIGIN, "https://example.com")
                    .header(SESSION_HEADER, &token),
            ),
        ),
    ];
    for (case, request) in cases {
        let answer = harness.send(request, case).await;
        answer.assert_no_token(&token, case);
    }
}

#[tokio::test]
async fn studio_answers_carry_the_token_in_no_header() {
    let relaying = Harness::relaying_ok().await;
    let unavailable =
        Harness::new(Script::Error(RelayError::Unavailable(Reason::NotStarted))).await;
    let cases = [
        (
            "relayed 200 with the token",
            &relaying,
            list_buckets(&relaying.token),
            StatusCode::OK,
        ),
        (
            "401 SessionInvalid",
            &relaying,
            list_buckets(&foreign_token().await),
            StatusCode::UNAUTHORIZED,
        ),
        (
            "relayed-path preflight",
            &relaying,
            empty(sdk_preflight("/", S, "PUT")),
            StatusCode::NO_CONTENT,
        ),
        (
            "503 EmulatorUnavailable with the token",
            &unavailable,
            list_buckets(&unavailable.token),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ];
    for (case, harness, request, status) in cases {
        let answer = read(harness.app.clone().oneshot(request).await.unwrap()).await;
        assert_eq!(answer.status, status, "case {case}: status");
        for (name, value) in &answer.headers {
            assert!(
                !name.as_str().contains(harness.token.as_str()),
                "case {case}: the token is in a header name"
            );
            assert!(
                !String::from_utf8_lossy(value.as_bytes()).contains(harness.token.as_str()),
                "case {case}: the token is in header {name}"
            );
        }
    }
}
