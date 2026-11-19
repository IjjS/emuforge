#![cfg(test)]

//! The channel `/__engine` on Studio's port (issue 503): Studio's server over `apps`, with a seam in place of the
//! emulator, a counted probe, Studio port 8296, engine port 8297 and the allowed name `name.test`.

use std::collections::VecDeque;
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
    ACCESS_CONTROL_REQUEST_METHOD, AUTHORIZATION, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE,
    HOST, ORIGIN, TRANSFER_ENCODING, VARY, WWW_AUTHENTICATE, X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use emuforge_core::{
    Health, Limits, Prepared, Reason, RelayError, SETTINGS_FILE, Store, TestReport, forward,
};
use emuforge_server::{
    AcceptedHosts, AppState, Apps, Form, ProbeFn, RelayFn, SessionToken, StudioFiles, StudioOrigin,
    StudioState, apps, seed_settings, studio_app,
};
use hyper::body::{Bytes, Frame};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::{mpsc, oneshot};
use tower::ServiceExt;

const STUDIO_HOST: &str = "127.0.0.1:8296";
const ENGINE_HOST: &str = "127.0.0.1:8297";
/// The page's own origin on loopback, which is also the engine port's Studio origin.
const OWN: &str = "http://127.0.0.1:8296";
const SESSION_HEADER: &str = "x-emuforge-session";
const SESSION: &str = "/__engine/__emuforge/session";
const HEALTH: &str = "/__engine/__emuforge/health";
const RELAYED: &str = "the seam's answer";
const JSON_1_0: &str = "application/x-amz-json-1.0";

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

// ---- The seam ----

/// What the seam's stand-in answers.
#[derive(Clone)]
enum Script {
    /// Exactly this status line, these headers and this body.
    Fixed {
        status: u16,
        headers: Vec<(&'static str, String)>,
        body: Vec<u8>,
    },
    /// A chunked `200` of these chunks, sent at once.
    Chunks(Vec<&'static str>),
    /// A chunked `200` whose head and first chunk are sent at once; the body ends when it is released.
    Held(mpsc::UnboundedSender<oneshot::Sender<()>>),
    /// The relay fails: the emulator is not reachable.
    Unavailable,
}

fn ok() -> Script {
    fixed(200, Vec::new(), RELAYED)
}

fn fixed(status: u16, mut headers: Vec<(&'static str, String)>, body: &str) -> Script {
    headers.push(("content-type", "text/plain".to_owned()));
    headers.push(("content-length", body.len().to_string()));
    Script::Fixed {
        status,
        headers,
        body: body.as_bytes().to_vec(),
    }
}

/// The request the seam was handed: its head and its body's bytes.
#[derive(Debug, Clone)]
struct Seen {
    target: String,
    headers: HeaderMap,
    body: Bytes,
}

/// The `RelayFn`: counts each call, reads the request body whole, records the request, and answers by its script
/// through `emuforge_core::forward` over a duplex stream to a stand-in.
struct Seam {
    relay: RelayFn,
    calls: Arc<AtomicUsize>,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Seam {
    fn answering(script: Script) -> Seam {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (counter, record) = (calls.clone(), seen.clone());
        let relay: RelayFn = Arc::new(move |_emulator, request: Request<Body>| {
            counter.fetch_add(1, Ordering::SeqCst);
            let (record, script) = (record.clone(), script.clone());
            Box::pin(async move {
                let (mut parts, body) = request.into_parts();
                let body = axum::body::to_bytes(body, usize::MAX)
                    .await
                    .unwrap_or_default();
                record.lock().unwrap().push(Seen {
                    target: parts.uri.to_string(),
                    headers: parts.headers.clone(),
                    body,
                });
                if let Script::Unavailable = script {
                    return Err(RelayError::Unavailable(Reason::ConnectionRefused));
                }
                // The body was read here; the stand-in is sent the head alone.
                parts.headers.remove(CONTENT_LENGTH);
                parts.headers.remove(TRANSFER_ENCODING);
                let (engine, emulator) = tokio::io::duplex(64 * 1024);
                tokio::spawn(stand_in(emulator, script, parts.method == Method::HEAD));
                forward(
                    engine,
                    Arc::new(AtomicBool::new(false)),
                    Prepared { head: parts },
                    Body::empty(),
                    &Limits::DEFAULT,
                )
                .await
            })
        });
        Seam { relay, calls, seen }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    fn seen(&self) -> Vec<Seen> {
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
            answer.push_str("\r\n");
            let mut bytes = answer.into_bytes();
            if !head_only {
                bytes.extend_from_slice(&body);
            }
            let _ = stream.write_all(&bytes).await;
        }
        Script::Chunks(chunks) => {
            let mut answer = "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n".to_owned();
            for chunk in chunks {
                answer.push_str(&format!("{:x}\r\n{chunk}\r\n", chunk.len()));
            }
            answer.push_str("0\r\n\r\n");
            let _ = stream.write_all(answer.as_bytes()).await;
        }
        Script::Held(releases) => {
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
        Script::Unavailable => {}
    }
}

// ---- The servers ----

/// A store whose folder does not exist: every load is the seed, `local` at `https://127.0.0.1:9391`.
fn absent_settings() -> Arc<Store> {
    Arc::new(Store::new(
        PathBuf::from("/h/.config/emuforge"),
        seed_settings(Form::Native, port(9391)),
    ))
}

/// What a harness is built from.
struct Setup {
    script: Script,
    health: Health,
    settings: Arc<Store>,
    engine_bound: usize,
    studio_bound: usize,
}

impl Default for Setup {
    fn default() -> Setup {
        Setup {
            script: ok(),
            health: Health::Reachable,
            settings: absent_settings(),
            engine_bound: 32,
            studio_bound: 32,
        }
    }
}

/// Studio's server over `apps`, the engine port's service of the same `apps`, the seam, the probe's count and T.
struct Harness {
    studio: Router,
    engine: Router,
    seam: Seam,
    probed: Arc<AtomicUsize>,
    token: String,
}

impl Harness {
    async fn new() -> Harness {
        Harness::with(Setup::default()).await
    }

    async fn answering(script: Script) -> Harness {
        Harness::with(Setup {
            script,
            ..Setup::default()
        })
        .await
    }

    async fn with(setup: Setup) -> Harness {
        let seam = Seam::answering(setup.script);
        let probed = Arc::new(AtomicUsize::new(0));
        let counter = probed.clone();
        let health = setup.health;
        let probe: ProbeFn = Arc::new(move |_emulator| {
            counter.fetch_add(1, Ordering::SeqCst);
            let health = health.clone();
            Box::pin(async move { health })
        });
        let accepted_hosts = AcceptedHosts::new(port(8296), vec!["name.test".parse().unwrap()]);
        let Apps { engine, channel } = apps(AppState {
            engine_port: port(8297),
            studio_port: port(8296),
            form: Form::Native,
            home: PathBuf::from("/h"),
            settings: setup.settings,
            probe,
            relay: seam.relay.clone(),
            test: Arc::new(|_| Box::pin(async { TestReport { checks: Vec::new() } })),
            max_in_flight: setup.engine_bound,
            studio_origin: StudioOrigin::new(port(8296)),
            session: Arc::new(SessionToken::generate().unwrap()),
            accepted_hosts: accepted_hosts.clone(),
        });
        let studio = studio_app(StudioState {
            studio_port: port(8296),
            engine_port: port(8297),
            files: Arc::new(StudioFiles::new([("index.html", &b"<p>studio</p>"[..])]).unwrap()),
            max_in_flight: setup.studio_bound,
            accepted_hosts,
            channel,
        });
        let token = engine_session(&engine).await;
        Harness {
            studio,
            engine,
            seam,
            probed,
            token,
        }
    }

    /// Sends `request` to Studio's port as a channel request and checks what every channel answer carries.
    async fn send(&self, request: Request<Body>, case: &str) -> Answer {
        let answer = read(self.studio.clone().oneshot(request).await.unwrap()).await;
        answer.assert_channel_headers(case);
        answer
    }

    /// As `send`, and the answer holds T nowhere.
    async fn send_without_token(&self, request: Request<Body>, case: &str) -> Answer {
        let answer = self.send(request, case).await;
        assert!(
            !String::from_utf8_lossy(&answer.body).contains(&self.token),
            "case {case}: the token in the body"
        );
        answer
    }

    async fn engine(&self, request: Request<Body>) -> Answer {
        read(self.engine.clone().oneshot(request).await.unwrap()).await
    }

    fn assert_untouched(&self, case: &str) {
        assert_eq!(self.seam.calls(), 0, "case {case}: relay calls");
        assert_eq!(
            self.probed.load(Ordering::SeqCst),
            0,
            "case {case}: probe calls"
        );
    }
}

/// The token, as the engine port gives it to the Studio origin.
async fn engine_session(engine: &Router) -> String {
    let request = Request::builder()
        .uri("/__emuforge/session")
        .header(HOST, ENGINE_HOST)
        .header(ORIGIN, OWN)
        .body(Body::empty())
        .unwrap();
    let answer = read(engine.clone().oneshot(request).await.unwrap()).await;
    assert_eq!(answer.status, StatusCode::OK, "the engine port's session");
    answer.json()["token"].as_str().unwrap().to_owned()
}

// ---- Requests and answers ----

/// `method target` on Studio's port with `Host: 127.0.0.1:8296`.
fn on(method: Method, target: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(target)
        .header(HOST, STUDIO_HOST)
}

fn empty(builder: axum::http::request::Builder) -> Request<Body> {
    builder.body(Body::empty()).unwrap()
}

/// `method target` on Studio's port with T.
fn with_token(method: Method, target: &str, token: &str) -> Request<Body> {
    empty(on(method, target).header(SESSION_HEADER, token))
}

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

async fn read(response: axum::response::Response) -> Answer {
    let (parts, body) = response.into_parts();
    Answer {
        status: parts.status,
        headers: parts.headers,
        body: axum::body::to_bytes(body, usize::MAX).await.unwrap(),
    }
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    fn code(&self) -> String {
        self.json()["error"]["code"].as_str().unwrap().to_owned()
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    fn values(&self, name: impl axum::http::header::AsHeaderName) -> Vec<&str> {
        self.headers
            .get_all(name)
            .iter()
            .map(|value| value.to_str().unwrap())
            .collect()
    }

    /// No `Access-Control-*`; `Cross-Origin-Resource-Policy: same-origin`; `Vary` holds `Origin` and
    /// `X-EmuForge-Session`; an `X-Content-Type-Options`.
    fn assert_channel_headers(&self, case: &str) {
        for name in self.headers.keys() {
            assert!(
                !name.as_str().starts_with("access-control-"),
                "case {case}: {name}"
            );
        }
        assert_eq!(
            self.values("cross-origin-resource-policy"),
            ["same-origin"],
            "case {case}"
        );
        let vary = self.values(VARY);
        for name in ["Origin", "X-EmuForge-Session"] {
            assert!(vary.contains(&name), "case {case}: Vary {vary:?}");
        }
        assert!(
            self.headers.contains_key(X_CONTENT_TYPE_OPTIONS),
            "case {case}: X-Content-Type-Options"
        );
    }
}

/// A request body of `frames`, one frame at a time.
struct Frames(VecDeque<&'static str>);

impl hyper::body::Body for Frames {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        Poll::Ready(
            self.get_mut()
                .0
                .pop_front()
                .map(|frame| Ok(Frame::data(Bytes::from_static(frame.as_bytes())))),
        )
    }
}

/// A request body that yields one frame and then never another.
struct Stalled(bool);

impl hyper::body::Body for Stalled {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        let this = self.get_mut();
        if this.0 {
            return Poll::Pending;
        }
        this.0 = true;
        Poll::Ready(Some(Ok(Frame::data(Bytes::from_static(b"first")))))
    }
}

// ---- The session and the engine's routes ----

#[tokio::test]
async fn channel_session_without_origin_is_the_token_uncached() {
    let harness = Harness::new().await;
    let answer = harness
        .send(empty(on(Method::GET, SESSION)), "session")
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.json()["token"], harness.token.as_str());
    assert_eq!(answer.values(CACHE_CONTROL), ["no-store"]);
}

#[tokio::test]
async fn channel_session_from_the_own_origin_is_the_engine_ports_token() {
    let harness = Harness::new().await;
    let answer = harness
        .send(
            empty(on(Method::GET, SESSION).header(ORIGIN, OWN)),
            "session",
        )
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.json()["token"], harness.token.as_str());
}

#[tokio::test]
async fn channel_health_with_the_token_is_the_engine_ports_health() {
    let harness = Harness::new().await;
    let channel = harness
        .send(with_token(Method::GET, HEALTH, &harness.token), "health")
        .await;
    let engine = harness
        .engine(empty(
            Request::builder()
                .uri("/__emuforge/health")
                .header(HOST, ENGINE_HOST)
                .header(ORIGIN, OWN)
                .header(SESSION_HEADER, &harness.token),
        ))
        .await;
    assert_eq!(channel.status, StatusCode::OK);
    assert_eq!(channel.status, engine.status);
    assert_eq!(channel.json(), engine.json());
    assert_eq!(channel.values(CONTENT_TYPE), engine.values(CONTENT_TYPE));
}

#[tokio::test]
async fn channel_post_to_the_session_route_is_401_without_token_and_405_with_it() {
    let harness = Harness::new().await;
    let without = harness
        .send_without_token(empty(on(Method::POST, SESSION)), "without")
        .await;
    assert_eq!(without.status, StatusCode::UNAUTHORIZED);
    assert_eq!(without.code(), "SessionRequired");
    let with = harness
        .send_without_token(with_token(Method::POST, SESSION, &harness.token), "with")
        .await;
    assert_eq!(with.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(with.code(), "MethodNotAllowed");
}

#[tokio::test]
async fn channel_engine_path_without_a_route_is_404_not_found() {
    let harness = Harness::new().await;
    let answer = harness
        .send_without_token(
            with_token(Method::GET, "/__engine/__emuforge/nothing", &harness.token),
            "nothing",
        )
        .await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(answer.code(), "NotFound");
}

// ---- The relay ----

#[tokio::test]
async fn channel_relayed_target_is_the_inner_path_byte_for_byte() {
    let harness = Harness::new().await;
    let answer = harness
        .send_without_token(
            with_token(
                Method::PUT,
                "/__engine/b/a%2Fb%20c?x=%E2%82%AC",
                &harness.token,
            ),
            "put",
        )
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(&answer.body[..], RELAYED.as_bytes());
    let seen = harness.seam.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/b/a%2Fb%20c?x=%E2%82%AC");
}

#[tokio::test]
async fn channel_root_with_or_without_slash_is_relayed_as_root() {
    for target in ["/__engine", "/__engine/"] {
        let harness = Harness::new().await;
        let answer = harness
            .send_without_token(with_token(Method::GET, target, &harness.token), target)
            .await;
        assert_eq!(answer.status, StatusCode::OK, "case {target}");
        assert_eq!(harness.seam.seen()[0].target, "/", "case {target}");
    }
}

#[tokio::test]
async fn channel_relayed_request_loses_the_browsers_and_the_forwarders_headers() {
    let harness = Harness::new().await;
    let removed = [
        ("origin", OWN),
        ("sec-fetch-site", "same-origin"),
        ("sec-fetch-mode", "cors"),
        ("forwarded", "for=100.64.0.9;proto=https"),
        ("x-forwarded-for", "100.64.0.9"),
        ("x-forwarded-host", "name.test"),
        ("x-forwarded-proto", "https"),
        ("x-real-ip", "100.64.0.9"),
        ("via", "1.1 forwarder"),
        ("tailscale-user-login", "someone@example.test"),
    ];
    let mut builder = on(Method::GET, "/__engine/b")
        .header(SESSION_HEADER, &harness.token)
        .header("x-amz-date", "20261119T000000Z");
    for (name, value) in removed {
        builder = builder.header(name, value);
    }
    let answer = harness.send_without_token(empty(builder), "strip").await;
    assert_eq!(answer.status, StatusCode::OK);
    let seen = harness.seam.seen();
    assert_eq!(
        seen[0].headers.get("x-amz-date").unwrap(),
        "20261119T000000Z"
    );
    for name in removed
        .iter()
        .map(|(name, _)| *name)
        .chain([SESSION_HEADER])
    {
        assert!(
            !seen[0].headers.contains_key(name),
            "{name} reached the relay"
        );
    }
}

#[tokio::test]
async fn channel_streamed_bodies_pass_whole_both_ways() {
    let harness = Harness::answering(Script::Chunks(vec!["first ", "second ", "third"])).await;
    let body = Body::new(Frames(VecDeque::from(["one ", "two ", "three"])));
    let request = on(Method::PUT, "/__engine/b/k")
        .header(SESSION_HEADER, &harness.token)
        .body(body)
        .unwrap();
    let answer = harness.send_without_token(request, "stream").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(&answer.body[..], b"first second third");
    assert_eq!(&harness.seam.seen()[0].body[..], b"one two three");
}

#[tokio::test]
async fn channel_under_an_allowed_name_relays_its_own_origin_by_either_scheme() {
    let cases = [
        ("https", "name.test", "https://name.test"),
        ("http", "name.test", "http://name.test"),
        ("mixed case", "Name.Test", "https://NAME.test"),
    ];
    for (name, host, origin) in cases {
        let harness = Harness::new().await;
        let request = Request::builder()
            .method(Method::POST)
            .uri("/__engine/")
            .header(HOST, host)
            .header(ORIGIN, origin)
            .header(SESSION_HEADER, &harness.token)
            .body(Body::empty())
            .unwrap();
        let answer = harness.send_without_token(request, name).await;
        assert_eq!(answer.status, StatusCode::OK, "case {name}");
        assert_eq!(harness.seam.calls(), 1, "case {name}");
    }
}

// ---- The refusals, in the order of requirement 3.4 ----

#[tokio::test]
async fn channel_host_not_accepted_is_421_whatever_origin_and_token() {
    let cases: [(&str, Method, &str, &[&str]); 5] = [
        ("other host", Method::GET, HEALTH, &["other.test"]),
        ("no host", Method::GET, HEALTH, &[]),
        (
            "two hosts",
            Method::GET,
            HEALTH,
            &["name.test", "name.test"],
        ),
        (
            "absolute form",
            Method::GET,
            "http://name.test/__engine/__emuforge/health",
            &["name.test"],
        ),
        ("CONNECT", Method::CONNECT, HEALTH, &["name.test"]),
    ];
    for (name, method, target, hosts) in cases {
        let harness = Harness::new().await;
        let mut builder = Request::builder()
            .method(method)
            .uri(target)
            .header(ORIGIN, "https://name.test")
            .header(SESSION_HEADER, &harness.token);
        for host in hosts {
            builder = builder.header(HOST, *host);
        }
        let answer = harness.send_without_token(empty(builder), name).await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {name}"
        );
        assert_eq!(answer.code(), "MisdirectedRequest", "case {name}");
        assert!(
            !answer.text().contains("name.test"),
            "case {name}: {}",
            answer.text()
        );
        harness.assert_untouched(name);
    }
}

#[tokio::test]
async fn channel_origin_not_the_requests_own_is_403_naming_the_host_and_the_forwarder_rule() {
    let cases: [(&str, &str, &[&str]); 7] = [
        ("foreign", STUDIO_HOST, &["http://evil.test"]),
        ("null", STUDIO_HOST, &["null"]),
        (
            "https on loopback",
            STUDIO_HOST,
            &["https://127.0.0.1:8296"],
        ),
        ("engine port", STUDIO_HOST, &["http://127.0.0.1:8297"]),
        (
            "allowed name on loopback",
            STUDIO_HOST,
            &["https://name.test"],
        ),
        ("twice", STUDIO_HOST, &[OWN, OWN]),
        ("foreign under a name", "name.test", &["http://evil.test"]),
    ];
    for (name, host, origins) in cases {
        let harness = Harness::new().await;
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri("/__engine/")
            .header(HOST, host)
            .header(SESSION_HEADER, &harness.token);
        for origin in origins {
            builder = builder.header(ORIGIN, *origin);
        }
        let answer = harness.send_without_token(empty(builder), name).await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "case {name}");
        let text = answer.text();
        assert!(text.contains("OriginNotAllowed"), "case {name}: {text}");
        assert!(
            text.contains(&format!("Host {host}")),
            "case {name}: {text}"
        );
        assert!(text.contains("forwards to Studio"), "case {name}: {text}");
        harness.assert_untouched(name);
    }
}

#[tokio::test]
async fn channel_session_with_a_cross_site_fetch_is_403_without_the_token() {
    for site in ["cross-site", "same-site", "none"] {
        let harness = Harness::new().await;
        let answer = harness
            .send_without_token(
                empty(on(Method::GET, SESSION).header("sec-fetch-site", site)),
                site,
            )
            .await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "case {site}");
        assert_eq!(answer.code(), "OriginNotAllowed", "case {site}");
    }
}

#[tokio::test]
async fn channel_without_token_is_401_session_required_with_or_without_origin() {
    let paths = [
        (Method::GET, "/__engine/b"),
        (Method::HEAD, "/__engine/b"),
        (Method::PUT, "/__engine/b"),
        (Method::POST, "/__engine/b"),
        (Method::DELETE, "/__engine/b"),
        (Method::GET, HEALTH),
    ];
    for (method, path) in paths {
        for origin in [None, Some(OWN)] {
            let case = format!("{method} {path} origin {origin:?}");
            let harness = Harness::new().await;
            let mut builder = on(method.clone(), path);
            if let Some(origin) = origin {
                builder = builder.header(ORIGIN, origin);
            }
            let answer = harness.send_without_token(empty(builder), &case).await;
            assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "case {case}");
            assert_eq!(
                answer.values(WWW_AUTHENTICATE),
                ["EmuForge-Session"],
                "case {case}"
            );
            if method != Method::HEAD {
                assert!(answer.text().contains("SessionRequired"), "case {case}");
            }
            harness.assert_untouched(&case);
        }
    }
}

#[tokio::test]
async fn channel_with_a_wrong_or_doubled_token_is_401_session_invalid() {
    for (method, path) in [(Method::PUT, "/__engine/b"), (Method::GET, HEALTH)] {
        for name in ["wrong", "twice"] {
            let case = format!("{name} {method} {path}");
            let harness = Harness::new().await;
            let builder = on(method.clone(), path);
            let builder = if name == "wrong" {
                builder.header(SESSION_HEADER, "0".repeat(64))
            } else {
                builder
                    .header(SESSION_HEADER, &harness.token)
                    .header(SESSION_HEADER, &harness.token)
            };
            let answer = harness.send_without_token(empty(builder), &case).await;
            assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "case {case}");
            assert_eq!(
                answer.values(WWW_AUTHENTICATE),
                ["EmuForge-Session"],
                "case {case}"
            );
            assert!(answer.text().contains("SessionInvalid"), "case {case}");
            harness.assert_untouched(&case);
        }
    }
}

#[tokio::test]
async fn channel_token_in_the_query_is_not_read() {
    let harness = Harness::new().await;
    let target = format!("/__engine/b?X-EmuForge-Session={}", harness.token);
    let answer = harness.send(empty(on(Method::GET, &target)), "query").await;
    assert_eq!(answer.status, StatusCode::UNAUTHORIZED);
    assert!(answer.text().contains("SessionRequired"));
    harness.assert_untouched("query");
}

#[tokio::test]
async fn channel_preflight_is_refused_like_any_request_without_cors_headers() {
    let harness = Harness::new().await;
    let request = on(Method::OPTIONS, "/__engine/b")
        .header(ORIGIN, OWN)
        .header(ACCESS_CONTROL_REQUEST_METHOD, "PUT");
    let answer = harness
        .send_without_token(empty(request), "preflight")
        .await;
    assert_eq!(answer.status, StatusCode::UNAUTHORIZED);
    assert!(answer.text().contains("SessionRequired"));
    harness.assert_untouched("preflight");
}

/// A request header-signed for `service` with a key the emulator does not know.
fn signed(builder: axum::http::request::Builder, service: &str) -> axum::http::request::Builder {
    builder
        .header(
            AUTHORIZATION,
            format!(
                "AWS4-HMAC-SHA256 Credential=AKIAEMUFORGESTUDIO01/20261119/us-east-1/{service}/aws4_request, SignedHeaders=host;x-amz-date, Signature={}",
                "0".repeat(64)
            ),
        )
        .header("x-amz-date", "20261119T000000Z")
}

#[tokio::test]
async fn channel_refusal_has_the_shape_the_engine_port_gives_the_inner_path() {
    type Build = fn(axum::http::request::Builder) -> axum::http::request::Builder;
    let cases: [(&str, Method, &str, Build); 4] = [
        ("engine path", Method::GET, "/__emuforge/health", |b| b),
        ("JSON protocol", Method::POST, "/", |b| {
            b.header("x-amz-target", "AWSStepFunctions.ListStateMachines")
                .header(CONTENT_TYPE, JSON_1_0)
        }),
        ("Query protocol", Method::POST, "/?Action=ListQueues", |b| {
            b.header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        }),
        ("REST-XML", Method::GET, "/b", |b| signed(b, "s3")),
    ];
    for (name, method, inner, build) in cases {
        let harness = Harness::new().await;
        let channel = harness
            .send_without_token(
                empty(build(on(method.clone(), &format!("/__engine{inner}")))),
                name,
            )
            .await;
        let engine = harness
            .engine(empty(build(
                Request::builder()
                    .method(method)
                    .uri(inner)
                    .header(HOST, ENGINE_HOST)
                    .header(ORIGIN, OWN),
            )))
            .await;
        assert_eq!(channel.status, StatusCode::UNAUTHORIZED, "case {name}");
        assert_eq!(channel.status, engine.status, "case {name}");
        assert_eq!(
            channel.values(CONTENT_TYPE),
            engine.values(CONTENT_TYPE),
            "case {name}"
        );
        assert_eq!(channel.body, engine.body, "case {name}");
    }
}

// ---- Every answer ----

#[tokio::test]
async fn channel_answers_lose_cors_headers_and_carry_corp_and_vary() {
    let script = fixed(
        200,
        vec![
            ("access-control-allow-origin", "*".to_owned()),
            (
                "access-control-expose-headers",
                "x-amz-request-id".to_owned(),
            ),
        ],
        RELAYED,
    );
    let harness = Harness::answering(script).await;
    let relayed = harness
        .send(
            with_token(Method::GET, "/__engine/b", &harness.token),
            "relayed",
        )
        .await;
    assert_eq!(relayed.status, StatusCode::OK);
    let refused = harness
        .send(
            empty(on(Method::GET, "/__engine/b").header(ORIGIN, OWN)),
            "refused",
        )
        .await;
    assert_eq!(refused.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn channel_relayed_nosniff_is_kept_when_set_and_added_when_absent() {
    let cases = [
        (
            "set",
            vec![("x-content-type-options", "other".to_owned())],
            "other",
        ),
        ("absent", Vec::new(), "nosniff"),
    ];
    for (name, headers, expected) in cases {
        let harness = Harness::answering(fixed(200, headers, RELAYED)).await;
        let answer = harness
            .send(with_token(Method::GET, "/__engine/b", &harness.token), name)
            .await;
        assert_eq!(
            answer.values(X_CONTENT_TYPE_OPTIONS),
            [expected],
            "case {name}"
        );
    }
}

#[tokio::test]
async fn channel_relayed_501_passes_with_its_body() {
    let harness = Harness::answering(fixed(501, Vec::new(), "not implemented")).await;
    let answer = harness
        .send(
            with_token(Method::POST, "/__engine/", &harness.token),
            "501",
        )
        .await;
    assert_eq!(answer.status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(&answer.body[..], b"not implemented");
}

// ---- Upstream states ----

#[tokio::test]
async fn channel_with_the_emulator_unreachable_is_503_in_the_callers_shape() {
    let harness = Harness::with(Setup {
        script: Script::Unavailable,
        health: Health::Unreachable(Reason::ConnectionRefused),
        ..Setup::default()
    })
    .await;
    let request = on(Method::POST, "/__engine/")
        .header(SESSION_HEADER, &harness.token)
        .header("x-amz-target", "AWSStepFunctions.ListStateMachines")
        .header(CONTENT_TYPE, JSON_1_0);
    let relayed = harness.send_without_token(empty(request), "relayed").await;
    assert_eq!(relayed.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(relayed.values(CONTENT_TYPE), [JSON_1_0]);
    assert!(
        relayed.text().contains("EmulatorUnavailable"),
        "{}",
        relayed.text()
    );
    let health = harness
        .send_without_token(with_token(Method::GET, HEALTH, &harness.token), "health")
        .await;
    assert_eq!(health.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(health.json()["emulator"]["reachable"], false);
}

#[tokio::test]
async fn channel_with_the_settings_file_unusable_is_503_settings_unusable() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(SETTINGS_FILE), "{not json").unwrap();
    let settings = Arc::new(Store::new(
        dir.path().to_owned(),
        seed_settings(Form::Native, port(9391)),
    ));
    let harness = Harness::with(Setup {
        settings,
        ..Setup::default()
    })
    .await;
    for path in ["/__engine/b", HEALTH] {
        let answer = harness
            .send_without_token(with_token(Method::GET, path, &harness.token), path)
            .await;
        assert_eq!(
            answer.status,
            StatusCode::SERVICE_UNAVAILABLE,
            "case {path}"
        );
        assert!(answer.text().contains("SettingsUnusable"), "case {path}");
    }
    assert_eq!(harness.seam.calls(), 0);
}

// ---- The in-flight bounds ----

/// Bounds of 1 for the engine and for Studio, and the seam holding each answer's body until it is released.
async fn bounded(script: Script) -> Harness {
    Harness::with(Setup {
        script,
        engine_bound: 1,
        studio_bound: 1,
        ..Setup::default()
    })
    .await
}

fn held() -> (Script, mpsc::UnboundedReceiver<oneshot::Sender<()>>) {
    let (releases, released) = mpsc::unbounded_channel();
    (Script::Held(releases), released)
}

#[tokio::test]
async fn channel_shares_the_engines_bound_with_the_engine_port() {
    let (script, mut releases) = held();
    let harness = bounded(script).await;
    let holding = harness
        .engine
        .clone()
        .oneshot(empty(
            Request::builder().uri("/bucket").header(HOST, ENGINE_HOST),
        ))
        .await
        .unwrap();
    assert_eq!(holding.status(), StatusCode::OK);
    let busy = harness
        .send(
            with_token(Method::GET, "/__engine/b", &harness.token),
            "busy",
        )
        .await;
    assert_eq!(busy.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(busy.text().contains("Busy"), "{}", busy.text());
    releases.recv().await.unwrap().send(()).unwrap();
    let body = axum::body::to_bytes(holding.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"first");
    let next = harness
        .studio
        .clone()
        .oneshot(with_token(Method::GET, "/__engine/b", &harness.token))
        .await
        .unwrap();
    assert_eq!(next.status(), StatusCode::OK);
}

#[tokio::test]
async fn studio_file_is_served_while_a_channel_request_holds_the_engines_place() {
    let (script, _releases) = held();
    let harness = bounded(script).await;
    let holding = harness
        .studio
        .clone()
        .oneshot(with_token(Method::GET, "/__engine/b", &harness.token))
        .await
        .unwrap();
    assert_eq!(holding.status(), StatusCode::OK);
    let page = harness
        .studio
        .clone()
        .oneshot(empty(on(Method::GET, "/")))
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    drop(holding);
}

#[tokio::test]
async fn channel_is_served_while_a_file_holds_studios_place() {
    let harness = bounded(ok()).await;
    let holding = harness
        .studio
        .clone()
        .oneshot(empty(on(Method::GET, "/")))
        .await
        .unwrap();
    assert_eq!(holding.status(), StatusCode::OK);
    let full = harness
        .studio
        .clone()
        .oneshot(empty(on(Method::GET, "/")))
        .await
        .unwrap();
    assert_eq!(
        full.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "Studio's bound"
    );
    let answer = harness
        .send(
            with_token(Method::GET, "/__engine/b", &harness.token),
            "channel",
        )
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    drop(holding);
}

#[tokio::test]
async fn channel_request_dropped_while_its_answer_streams_gives_its_place_back() {
    let (script, _releases) = held();
    let harness = bounded(script).await;
    let dropped = harness
        .studio
        .clone()
        .oneshot(with_token(Method::GET, "/__engine/b", &harness.token))
        .await
        .unwrap();
    assert_eq!(dropped.status(), StatusCode::OK);
    drop(dropped);
    let next = harness
        .studio
        .clone()
        .oneshot(with_token(Method::GET, "/__engine/b", &harness.token))
        .await
        .unwrap();
    assert_eq!(next.status(), StatusCode::OK);
}

#[tokio::test]
async fn channel_request_dropped_while_its_body_streams_gives_its_place_back() {
    tokio::time::pause();
    let harness = bounded(ok()).await;
    let stalled = on(Method::PUT, "/__engine/b/k")
        .header(SESSION_HEADER, &harness.token)
        .body(Body::new(Stalled(false)))
        .unwrap();
    let pending = tokio::time::timeout(
        Duration::from_secs(1),
        harness.studio.clone().oneshot(stalled),
    )
    .await;
    assert!(pending.is_err(), "the stalled request was answered");
    assert_eq!(
        harness.seam.calls(),
        1,
        "the stalled request reached the relay"
    );
    let next = harness
        .send(
            with_token(Method::GET, "/__engine/b", &harness.token),
            "next",
        )
        .await;
    assert_eq!(next.status, StatusCode::OK);
}

// ---- The engine port, unchanged ----

#[tokio::test]
async fn engine_port_refuses_an_allowed_name_as_host_or_origin() {
    let harness = Harness::new().await;
    for host in ["name.test", "name.test:8297"] {
        let answer = harness
            .engine(empty(
                Request::builder()
                    .uri("/__emuforge/health")
                    .header(HOST, host),
            ))
            .await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {host}"
        );
        assert_eq!(answer.code(), "MisdirectedRequest", "case {host}");
    }
    let answer = harness
        .engine(empty(
            Request::builder()
                .uri("/__emuforge/health")
                .header(HOST, ENGINE_HOST)
                .header(ORIGIN, "https://name.test"),
        ))
        .await;
    assert_eq!(answer.status, StatusCode::FORBIDDEN);
    assert_eq!(answer.code(), "OriginNotAllowed");
    harness.assert_untouched("engine port");
}

#[tokio::test]
async fn engine_port_relays_an_aws_client_without_a_token_as_today() {
    let harness = Harness::new().await;
    let answer = harness
        .engine(empty(
            Request::builder().uri("/bucket").header(HOST, ENGINE_HOST),
        ))
        .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(&answer.body[..], RELAYED.as_bytes());
    assert_eq!(harness.seam.calls(), 1);
}
