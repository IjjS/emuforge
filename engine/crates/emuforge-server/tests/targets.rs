#![cfg(test)]

//! The targets API under `/__emuforge/targets` as a local tool and the Studio origin see it (issue 485).

use std::collections::VecDeque;
use std::fs;
use std::num::NonZeroU16;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_REQUEST_HEADERS, ACCESS_CONTROL_REQUEST_METHOD, ALLOW, CONTENT_LENGTH,
    CONTENT_TYPE, HOST, ORIGIN,
};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use emuforge_core::{
    CREDENTIALS_FILE, Emulator, Health, Outcome, Reason, SETTINGS_FILE, Step, Store, TestReport,
};
use emuforge_server::{
    AppState, Form, ProbeFn, RelayFn, SessionToken, StudioOrigin, TestFn, app, seed_settings,
};
use hyper::body::{Bytes, Frame};
use serde_json::{Value, json};
use tokio::sync::Notify;
use tower::ServiceExt;

const ENGINE_HOST: &str = "127.0.0.1:8297";
const STUDIO: &str = "http://127.0.0.1:8296";
const TARGETS: &str = "/__emuforge/targets";
const HEALTH: &str = "/__emuforge/health";
const SESSION_HEADER: &str = "x-emuforge-session";
const KEY_ID: &str = "AKIATARGETSTEST00001";
const SECRET: &str = "targetsTestSecretKey0000000000000000000";

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

/// What the fakes were given.
#[derive(Default)]
struct Seen {
    probed: Mutex<Vec<Emulator>>,
    tested: Mutex<Vec<Emulator>>,
}

/// An app on engine port 8297 and Studio port 8296, whose settings folder is `<root>/settings` (absent at
/// first) and whose home is `<root>/home`, which holds the emulator files of port 9391 with a known key.
struct Fixture {
    root: tempfile::TempDir,
    app: Router,
    seen: Arc<Seen>,
    token: String,
}

struct Options {
    form: Form,
    max_in_flight: usize,
    report: TestReport,
    hold: Option<Arc<Notify>>,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            form: Form::Native,
            max_in_flight: 32,
            report: report(&[]),
            hold: None,
        }
    }
}

fn fixture() -> Fixture {
    fixture_with(Options::default())
}

fn fixture_with(options: Options) -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("home");
    let files = home.join(".aws/emulator/9391");
    fs::create_dir_all(&files).unwrap();
    fs::write(
        files.join(CREDENTIALS_FILE),
        format!("[default]\naws_access_key_id = {KEY_ID}\naws_secret_access_key = {SECRET}\n"),
    )
    .unwrap();
    let seen = Arc::new(Seen::default());
    let probe_seen = seen.clone();
    let probe: ProbeFn = Arc::new(move |emulator| {
        probe_seen.probed.lock().unwrap().push(emulator);
        Box::pin(async { Health::Unreachable(Reason::ConnectionRefused) })
    });
    let relay: RelayFn = Arc::new(|_, _| panic!("no targets route relays"));
    let test_seen = seen.clone();
    let (answer, hold) = (options.report, options.hold);
    let test: TestFn = Arc::new(move |emulator| {
        test_seen.tested.lock().unwrap().push(emulator);
        let (answer, hold) = (answer.clone(), hold.clone());
        Box::pin(async move {
            if let Some(hold) = hold {
                hold.notified().await;
            }
            answer
        })
    });
    let session = Arc::new(SessionToken::generate().unwrap());
    let token = session.expose().to_owned();
    let app = app(AppState {
        engine_port: port(8297),
        studio_port: port(8296),
        form: options.form,
        home,
        settings: Arc::new(Store::new(
            root.path().join("settings"),
            seed_settings(options.form, port(9391)),
        )),
        probe,
        relay,
        test,
        max_in_flight: options.max_in_flight,
        studio_origin: StudioOrigin::new(port(8296)),
        session,
    });
    Fixture {
        root,
        app,
        seen,
        token,
    }
}

fn report(failed: &[(Step, Reason)]) -> TestReport {
    let mut failure = failed.iter().cloned();
    let first = failure.next();
    let failed_at = first
        .as_ref()
        .map_or(Step::ALL.len(), |(step, _)| *step as usize);
    let mut reason = first.map(|(_, reason)| reason);
    TestReport {
        checks: Step::ALL
            .iter()
            .enumerate()
            .map(|(index, step)| {
                let outcome = if index < failed_at {
                    Outcome::Passed
                } else if let Some(reason) = reason.take() {
                    Outcome::Failed(reason)
                } else {
                    Outcome::NotRun
                };
                (*step, outcome)
            })
            .collect(),
    }
}

impl Fixture {
    fn settings_dir(&self) -> PathBuf {
        self.root.path().join("settings")
    }

    fn file(&self) -> PathBuf {
        self.settings_dir().join(SETTINGS_FILE)
    }

    /// The settings file's bytes, `None` when it does not exist.
    fn file_bytes(&self) -> Option<Vec<u8>> {
        fs::read(self.file()).ok()
    }

    fn write_file(&self, bytes: &[u8]) {
        fs::create_dir_all(self.settings_dir()).unwrap();
        fs::write(self.file(), bytes).unwrap();
    }

    async fn send(&self, request: Request<Body>) -> Answer {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let (parts, body) = response.into_parts();
        let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        Answer {
            status: parts.status,
            headers: parts.headers,
            body,
        }
    }

    async fn call(&self, method: Method, path: &str) -> Answer {
        self.send(request(method, path).body(Body::empty()).unwrap())
            .await
    }

    async fn add(&self, body: Value) -> Answer {
        self.send(json_post(TARGETS, &body.to_string())).await
    }

    async fn add_target(&self, name: &str, endpoint: &str) {
        let answer = self.add(json!({"name": name, "endpoint": endpoint})).await;
        assert_eq!(answer.status, StatusCode::CREATED, "add {name}: {answer:?}");
    }

    async fn list(&self) -> Value {
        let answer = self.call(Method::GET, TARGETS).await;
        assert_eq!(answer.status, StatusCode::OK, "{answer:?}");
        answer.json()
    }
}

fn request(method: Method, path: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, ENGINE_HOST)
}

fn json_post(path: &str, body: &str) -> Request<Body> {
    request(Method::POST, path)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl std::fmt::Debug for Answer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status, String::from_utf8_lossy(&self.body))
    }
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    fn message(&self) -> String {
        self.json()["error"]["message"].as_str().unwrap().to_owned()
    }

    /// An engine refusal in #1's shape with `status` and `code`.
    fn assert_error(&self, status: StatusCode, code: &str, case: &str) {
        assert_eq!(self.status, status, "case {case}: {self:?}");
        let body = self.json();
        assert_eq!(body["error"]["code"], code, "case {case}: {self:?}");
        assert!(body["error"]["message"].is_string(), "case {case}");
        assert_eq!(
            body.as_object().unwrap().len(),
            1,
            "case {case}: only `error`"
        );
    }
}

fn names(list: &Value) -> Vec<String> {
    list["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|target| target["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn list_with_the_file_absent_is_local_active() {
    let fixture = fixture();
    assert_eq!(
        fixture.list().await,
        json!({
            "active": "local",
            "targets": [{
                "name": "local",
                "provider": "aws",
                "emulator": "aws-emulator",
                "endpoint": "https://127.0.0.1:9391",
                "credentials": "emulator-files",
                "tls": "emulator-ca",
                "active": true
            }]
        })
    );
    assert!(fixture.file_bytes().is_none());
}

#[tokio::test]
async fn add_valid_target_is_201_listed_and_written_with_local_still_active() {
    let fixture = fixture();
    let answer = fixture
        .add(json!({"name": "second", "endpoint": "https://127.0.0.2:9400/"}))
        .await;
    assert_eq!(answer.status, StatusCode::CREATED, "{answer:?}");
    assert_eq!(
        answer.json(),
        json!({
            "name": "second",
            "provider": "aws",
            "emulator": "aws-emulator",
            "endpoint": "https://127.0.0.2:9400",
            "credentials": "emulator-files",
            "tls": "emulator-ca",
            "active": false
        })
    );
    let list = fixture.list().await;
    assert_eq!(list["active"], "local");
    assert_eq!(names(&list), ["local", "second"]);
    let file: Value = serde_json::from_slice(&fixture.file_bytes().unwrap()).unwrap();
    assert_eq!(file["active"], "local");
    let held: Vec<&str> = file["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|target| target["name"].as_str().unwrap())
        .collect();
    assert_eq!(held, ["local", "second"]);
}

#[tokio::test]
async fn add_without_json_content_type_is_415_and_writes_nothing() {
    let fixture = fixture();
    let body = json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string();
    for content_type in [
        None,
        Some("text/plain"),
        Some("application/x-www-form-urlencoded"),
    ] {
        let mut builder = request(Method::POST, TARGETS);
        if let Some(value) = content_type {
            builder = builder.header(CONTENT_TYPE, value);
        }
        let answer = fixture
            .send(builder.body(Body::from(body.clone())).unwrap())
            .await;
        let case = format!("{content_type:?}");
        answer.assert_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UnsupportedMediaType",
            &case,
        );
        assert!(fixture.file_bytes().is_none(), "case {case}");
    }
}

/// A valid add body of exactly `size` bytes, padded with spaces.
fn body_of(size: usize) -> String {
    let mut body = json!({"name": "padded", "endpoint": "https://127.0.0.1:9400"}).to_string();
    body.push_str(&" ".repeat(size - body.len()));
    body
}

#[tokio::test]
async fn add_body_of_4_kib_is_read_and_one_byte_more_is_413() {
    let at_cap = fixture();
    let answer = at_cap.send(json_post(TARGETS, &body_of(4096))).await;
    assert_eq!(answer.status, StatusCode::CREATED, "4096 bytes: {answer:?}");

    let fixture = fixture();
    let over = body_of(4097);
    let by_length = request(Method::POST, TARGETS)
        .header(CONTENT_TYPE, "application/json")
        .header(CONTENT_LENGTH, over.len())
        .body(Body::from(over.clone()))
        .unwrap();
    let chunks = over
        .as_bytes()
        .chunks(1000)
        .map(Bytes::copy_from_slice)
        .collect();
    let chunked = request(Method::POST, TARGETS)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::new(Chunks(chunks)))
        .unwrap();
    for (case, request) in [("by Content-Length", by_length), ("chunked", chunked)] {
        let answer = fixture.send(request).await;
        answer.assert_error(StatusCode::PAYLOAD_TOO_LARGE, "BodyTooLarge", case);
        assert!(fixture.file_bytes().is_none(), "case {case}");
    }
}

/// A request body that sends one chunk and then fails.
struct FailsAfterOne(Option<Bytes>);

impl hyper::body::Body for FailsAfterOne {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        Poll::Ready(Some(match self.0.take() {
            Some(chunk) => Ok(Frame::data(chunk)),
            None => Err(std::io::Error::other("the client went away")),
        }))
    }
}

#[tokio::test]
async fn add_body_that_fails_while_read_is_400_target_invalid_naming_body() {
    let fixture = fixture();
    let answer = fixture
        .send(
            request(Method::POST, TARGETS)
                .header(CONTENT_TYPE, "application/json")
                .body(Body::new(FailsAfterOne(Some(Bytes::from_static(
                    b"{\"name\":",
                )))))
                .unwrap(),
        )
        .await;
    answer.assert_error(StatusCode::BAD_REQUEST, "TargetInvalid", "failed body");
    assert!(answer.message().contains("body"), "{answer:?}");
    assert!(fixture.file_bytes().is_none());
}

/// A request body of these chunks with no length, as a chunked upload.
struct Chunks(VecDeque<Bytes>);

impl hyper::body::Body for Chunks {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        Poll::Ready(self.0.pop_front().map(|chunk| Ok(Frame::data(chunk))))
    }
}

#[tokio::test]
async fn add_broken_body_is_400_target_invalid_naming_the_field() {
    let fixture = fixture();
    let cases = [
        ("not JSON", "{name: second".to_owned(), "body"),
        (
            "name missing",
            json!({"endpoint": "https://127.0.0.1:9400"}).to_string(),
            "name",
        ),
        (
            "endpoint missing",
            json!({"name": "second"}).to_string(),
            "endpoint",
        ),
        (
            "unknown field",
            json!({"name": "second", "endpoint": "https://127.0.0.1:9400", "colour": "red"})
                .to_string(),
            "colour",
        ),
    ];
    for (case, body, field) in cases {
        let answer = fixture.send(json_post(TARGETS, &body)).await;
        answer.assert_error(StatusCode::BAD_REQUEST, "TargetInvalid", case);
        assert!(answer.message().contains(field), "case {case}: {answer:?}");
        assert!(fixture.file_bytes().is_none(), "case {case}");
    }
}

#[tokio::test]
async fn add_endpoint_not_loopback_or_at_an_own_port_is_refused() {
    let fixture = fixture();
    let answer = fixture
        .add(json!({"name": "named", "endpoint": "https://localhost:9300"}))
        .await;
    answer.assert_error(StatusCode::BAD_REQUEST, "EndpointNotLoopback", "localhost");
    for (case, endpoint) in [
        ("engine port", "https://127.0.0.1:8297"),
        ("studio port", "https://127.0.0.1:8296"),
    ] {
        let answer = fixture
            .add(json!({"name": "own", "endpoint": endpoint}))
            .await;
        answer.assert_error(StatusCode::BAD_REQUEST, "TargetInvalid", case);
        assert!(answer.message().contains("endpoint"), "case {case}");
    }
    assert!(fixture.file_bytes().is_none());
}

#[tokio::test]
async fn add_name_taken_is_409_target_exists_and_the_33rd_is_409_target_limit() {
    let fixture = fixture();
    let answer = fixture
        .add(json!({"name": "local", "endpoint": "https://127.0.0.1:9400"}))
        .await;
    answer.assert_error(StatusCode::CONFLICT, "TargetExists", "taken");
    for index in 1..32 {
        fixture
            .add_target(&format!("t{index}"), "https://127.0.0.1:9400")
            .await;
    }
    assert_eq!(names(&fixture.list().await).len(), 32);
    let before = fixture.file_bytes();
    let answer = fixture
        .add(json!({"name": "one-more", "endpoint": "https://127.0.0.1:9400"}))
        .await;
    answer.assert_error(StatusCode::CONFLICT, "TargetLimit", "33rd");
    assert_eq!(fixture.file_bytes(), before);
}

#[tokio::test]
async fn add_in_the_compose_form_is_403_whatever_the_body() {
    let fixture = fixture_with(Options {
        form: Form::Compose,
        ..Options::default()
    });
    let valid = json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string();
    let cases = [
        ("valid", json_post(TARGETS, &valid)),
        ("broken", json_post(TARGETS, "{not json")),
        (
            "empty, no content type",
            request(Method::POST, TARGETS).body(Body::empty()).unwrap(),
        ),
    ];
    for (case, request) in cases {
        let answer = fixture.send(request).await;
        answer.assert_error(StatusCode::FORBIDDEN, "ComposeHoldsOneTarget", case);
        assert!(fixture.file_bytes().is_none(), "case {case}");
    }
}

#[tokio::test]
async fn compose_target_cannot_be_removed_and_can_be_used_and_tested() {
    let fixture = fixture_with(Options {
        form: Form::Compose,
        ..Options::default()
    });
    let path = format!("{TARGETS}/compose");
    fixture.call(Method::DELETE, &path).await.assert_error(
        StatusCode::CONFLICT,
        "TargetActive",
        "remove",
    );
    let used = fixture.call(Method::POST, &format!("{path}/use")).await;
    assert_eq!(used.status, StatusCode::OK, "{used:?}");
    assert_eq!(used.json()["active"], "compose");
    let tested = fixture.call(Method::POST, &format!("{path}/test")).await;
    assert_eq!(tested.status, StatusCode::OK, "{tested:?}");
    assert_eq!(tested.json()["name"], "compose");
}

#[tokio::test]
async fn info_of_a_held_target_is_200_with_credentials_dir_and_its_probed_health() {
    let fixture = fixture();
    fixture.add_target("second", "https://127.0.0.2:9400").await;
    let answer = fixture
        .call(Method::GET, &format!("{TARGETS}/second"))
        .await;
    assert_eq!(answer.status, StatusCode::OK, "{answer:?}");
    let body = answer.json();
    assert_eq!(body["name"], "second");
    assert_eq!(body["endpoint"], "https://127.0.0.2:9400");
    assert_eq!(body["active"], false);
    assert_eq!(body["credentials_dir"], "~/.aws/emulator/9400/");
    assert_eq!(body["health"]["reachable"], false);
    assert_eq!(body["health"]["reason"], "connection_refused");
    assert!(body["health"]["message"].is_string());
    let probed = fixture.seen.probed.lock().unwrap();
    assert_eq!(probed.len(), 1);
    assert_eq!(probed[0].socket_addr().to_string(), "127.0.0.2:9400");
}

#[tokio::test]
async fn info_of_a_name_not_held_or_breaking_the_rule_is_404() {
    let fixture = fixture();
    let long = "a".repeat(65);
    for (case, name) in [
        ("not held", "absent"),
        ("upper", "UPPER"),
        ("65 characters", &long),
    ] {
        fixture
            .call(Method::GET, &format!("{TARGETS}/{name}"))
            .await
            .assert_error(StatusCode::NOT_FOUND, "TargetNotFound", case);
    }
    assert!(fixture.seen.probed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn use_of_another_target_is_200_active_and_health_follows() {
    let fixture = fixture();
    fixture.add_target("second", "https://127.0.0.2:9400").await;
    let answer = fixture
        .call(Method::POST, &format!("{TARGETS}/second/use"))
        .await;
    assert_eq!(answer.status, StatusCode::OK, "{answer:?}");
    let body = answer.json();
    assert_eq!(body["active"], "second");
    assert_eq!(names(&body), ["local", "second"]);
    let health = fixture.call(Method::GET, HEALTH).await;
    assert_eq!(health.json()["target"], "second");
    assert_eq!(
        health.json()["emulator"]["endpoint"],
        "https://127.0.0.2:9400"
    );
}

#[tokio::test]
async fn use_of_the_active_one_with_the_file_absent_is_200_and_writes_nothing() {
    let fixture = fixture();
    let answer = fixture
        .call(Method::POST, &format!("{TARGETS}/local/use"))
        .await;
    assert_eq!(answer.status, StatusCode::OK, "{answer:?}");
    assert_eq!(answer.json()["active"], "local");
    assert!(!fixture.settings_dir().exists());
}

#[tokio::test]
async fn test_of_a_held_target_is_200_with_the_fake_checks_and_its_address() {
    let passing = fixture();
    passing.add_target("second", "https://127.0.0.2:9400").await;
    let answer = passing
        .call(Method::POST, &format!("{TARGETS}/second/test"))
        .await;
    assert_eq!(answer.status, StatusCode::OK, "{answer:?}");
    let body = answer.json();
    assert_eq!(body["name"], "second");
    assert_eq!(body["endpoint"], "https://127.0.0.2:9400");
    assert_eq!(body["passed"], true);
    let checks: Vec<(String, String)> = body["checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|check| {
            (
                check["check"].as_str().unwrap().to_owned(),
                check["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    let expected: Vec<(String, String)> = ["files", "connection", "tls", "health", "credentials"]
        .iter()
        .map(|step| ((*step).to_owned(), "passed".to_owned()))
        .collect();
    assert_eq!(checks, expected);
    let tested: Vec<String> = passing
        .seen
        .tested
        .lock()
        .unwrap()
        .iter()
        .map(|emulator| emulator.socket_addr().to_string())
        .collect();
    assert_eq!(tested, ["127.0.0.2:9400"]);

    let failing = fixture_with(Options {
        report: report(&[(Step::Tls, Reason::TlsUntrusted)]),
        ..Options::default()
    });
    let body = failing
        .call(Method::POST, &format!("{TARGETS}/local/test"))
        .await
        .json();
    assert_eq!(body["passed"], false);
    assert_eq!(body["checks"][1]["status"], "passed");
    assert_eq!(body["checks"][2]["check"], "tls");
    assert_eq!(body["checks"][2]["status"], "failed");
    assert_eq!(body["checks"][2]["reason"], "tls_untrusted");
    assert!(body["checks"][2]["message"].is_string());
    assert_eq!(body["checks"][3]["status"], "not_run");
    assert!(body["checks"][3].get("reason").is_none());

    failing
        .call(Method::POST, &format!("{TARGETS}/absent/test"))
        .await
        .assert_error(StatusCode::NOT_FOUND, "TargetNotFound", "not held");
}

#[tokio::test]
async fn test_credentials_unexpected_response_names_the_signed_sts_request_not_the_health_route() {
    let fixture = fixture_with(Options {
        report: report(&[(
            Step::Credentials,
            Reason::UnexpectedResponse { status: 500 },
        )]),
        ..Options::default()
    });
    let body = fixture
        .call(Method::POST, &format!("{TARGETS}/local/test"))
        .await
        .json();
    let credentials = &body["checks"][4];
    assert_eq!(credentials["check"], "credentials");
    assert_eq!(credentials["reason"], "unexpected_response");
    let message = credentials["message"].as_str().unwrap();
    assert_eq!(
        message,
        "the emulator on https://127.0.0.1:9391 answered the signed STS GetCallerIdentity with status 500, not 200"
    );
    assert!(!message.contains("/__admin/health"), "{message}");
}

#[tokio::test]
async fn remove_is_204_for_a_held_target_409_for_the_active_and_404_for_none() {
    let fixture = fixture();
    fixture.add_target("second", "https://127.0.0.2:9400").await;
    let answer = fixture
        .call(Method::DELETE, &format!("{TARGETS}/second"))
        .await;
    assert_eq!(answer.status, StatusCode::NO_CONTENT, "{answer:?}");
    assert!(answer.body.is_empty());
    assert_eq!(names(&fixture.list().await), ["local"]);
    fixture
        .call(Method::DELETE, &format!("{TARGETS}/local"))
        .await
        .assert_error(StatusCode::CONFLICT, "TargetActive", "active");
    fixture
        .call(Method::DELETE, &format!("{TARGETS}/absent"))
        .await
        .assert_error(StatusCode::NOT_FOUND, "TargetNotFound", "not held");
}

/// Every targets route once, with an add body that would be valid.
fn every_route() -> Vec<(&'static str, Request<Body>)> {
    let valid = json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string();
    vec![
        (
            "list",
            request(Method::GET, TARGETS).body(Body::empty()).unwrap(),
        ),
        ("add", json_post(TARGETS, &valid)),
        (
            "info",
            request(Method::GET, "/__emuforge/targets/local")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "use",
            request(Method::POST, "/__emuforge/targets/local/use")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "test",
            request(Method::POST, "/__emuforge/targets/local/test")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "remove",
            request(Method::DELETE, "/__emuforge/targets/local")
                .body(Body::empty())
                .unwrap(),
        ),
    ]
}

#[tokio::test]
async fn every_route_with_the_file_unusable_is_503_settings_unusable_and_the_file_unchanged() {
    let fixture = fixture();
    fixture.write_file(b"{ not json");
    for (case, request) in every_route() {
        let answer = fixture.send(request).await;
        answer.assert_error(StatusCode::SERVICE_UNAVAILABLE, "SettingsUnusable", case);
        assert!(
            answer
                .message()
                .contains(&fixture.file().display().to_string()),
            "case {case}"
        );
        assert_eq!(fixture.file_bytes().unwrap(), b"{ not json", "case {case}");
    }
    assert!(fixture.seen.tested.lock().unwrap().is_empty());
    assert!(fixture.seen.probed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn changes_with_the_folder_not_writable_are_500_settings_write_failed() {
    let fixture = fixture();
    fixture.add_target("second", "https://127.0.0.2:9400").await;
    let before = fixture.list().await;
    let dir = fixture.settings_dir();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
    assert!(
        fs::write(dir.join("probe"), b"").is_err(),
        "the folder must refuse writes for this case (tests run as a user without root's override)"
    );
    let cases = [
        (
            "add",
            json_post(
                TARGETS,
                &json!({"name": "third", "endpoint": "https://127.0.0.1:9401"}).to_string(),
            ),
        ),
        (
            "use",
            request(Method::POST, "/__emuforge/targets/second/use")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "remove",
            request(Method::DELETE, "/__emuforge/targets/second")
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (case, request) in cases {
        let answer = fixture.send(request).await;
        answer.assert_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "SettingsWriteFailed",
            case,
        );
        assert!(
            answer
                .message()
                .contains(&fixture.file().display().to_string()),
            "case {case}"
        );
        assert_eq!(fixture.list().await, before, "case {case}");
    }
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
}

#[tokio::test]
async fn head_of_list_and_info_is_get_without_a_body() {
    let fixture = fixture();
    for path in [
        TARGETS,
        "/__emuforge/targets/local",
        "/__emuforge/targets/absent",
    ] {
        let got = fixture.call(Method::GET, path).await;
        let head = fixture.call(Method::HEAD, path).await;
        assert_eq!(head.status, got.status, "path {path}");
        assert_eq!(head.headers, got.headers, "path {path}");
        assert!(head.body.is_empty(), "path {path}");
    }
}

#[tokio::test]
async fn a_targets_route_with_32_in_flight_is_503_busy() {
    let hold = Arc::new(Notify::new());
    let fixture = Arc::new(fixture_with(Options {
        hold: Some(hold.clone()),
        ..Options::default()
    }));
    let mut held = Vec::new();
    for _ in 0..32 {
        let app = fixture.app.clone();
        held.push(tokio::spawn(async move {
            app.oneshot(
                request(Method::POST, "/__emuforge/targets/local/test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }));
    }
    while fixture.seen.tested.lock().unwrap().len() < 32 {
        tokio::task::yield_now().await;
    }
    for (case, request) in every_route() {
        fixture
            .send(request)
            .await
            .assert_error(StatusCode::SERVICE_UNAVAILABLE, "Busy", case);
    }
    hold.notify_waiters();
    for task in held {
        assert_eq!(task.await.unwrap(), StatusCode::OK);
    }
}

thread_local! {
    /// Where this thread's `tracing` lines go while [`captured`] runs.
    static CAPTURE: std::cell::RefCell<Option<Arc<Mutex<Vec<u8>>>>> = const { std::cell::RefCell::new(None) };
}

/// Writes into this thread's capture, or nowhere.
struct ThreadWriter;

impl std::io::Write for ThreadWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        CAPTURE.with(|capture| {
            if let Some(lines) = capture.borrow().as_ref() {
                lines.lock().unwrap().extend_from_slice(bytes);
            }
        });
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The lines of every `tracing` event this thread emits while `run` runs. One global subscriber serves every
/// test, so no callsite's interest is decided while another thread has no subscriber.
async fn captured<F: std::future::Future<Output = ()>>(run: F) -> String {
    static GLOBAL: std::sync::Once = std::sync::Once::new();
    GLOBAL.call_once(|| {
        let subscriber = tracing_subscriber::fmt()
            .with_writer(|| ThreadWriter)
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .finish();
        tracing::subscriber::set_global_default(subscriber).unwrap();
    });
    let lines = Arc::new(Mutex::new(Vec::new()));
    CAPTURE.with(|capture| *capture.borrow_mut() = Some(lines.clone()));
    run.await;
    CAPTURE.with(|capture| *capture.borrow_mut() = None);
    String::from_utf8(lines.lock().unwrap().clone()).unwrap()
}

fn info_lines(log: &str) -> Vec<&str> {
    log.lines().filter(|line| line.contains("INFO")).collect()
}

#[tokio::test(flavor = "current_thread")]
async fn successful_changes_log_one_info_line_each_with_kind_name_and_endpoint() {
    let fixture = fixture();
    let cases: [(&str, Request<Body>, [&str; 3]); 3] = [
        (
            "add",
            json_post(
                TARGETS,
                &json!({"name": "second", "endpoint": "https://127.0.0.2:9400"}).to_string(),
            ),
            ["add", "second", "https://127.0.0.2:9400"],
        ),
        (
            "use",
            request(Method::POST, "/__emuforge/targets/second/use")
                .body(Body::empty())
                .unwrap(),
            ["use", "second", "https://127.0.0.2:9400"],
        ),
        (
            "remove",
            request(Method::DELETE, "/__emuforge/targets/local")
                .body(Body::empty())
                .unwrap(),
            ["remove", "local", "https://127.0.0.1:9391"],
        ),
    ];
    for (case, request, words) in cases {
        let log = captured(async {
            let answer = fixture.send(request).await;
            assert!(answer.status.is_success(), "case {case}: {answer:?}");
        })
        .await;
        let lines = info_lines(&log);
        assert_eq!(lines.len(), 1, "case {case}: {log}");
        for word in words {
            assert!(
                lines[0].contains(word),
                "case {case}: {word} in {}",
                lines[0]
            );
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn refused_changes_and_use_of_the_active_one_log_no_change_line() {
    let fixture = fixture();
    let cases = [
        (
            "add taken",
            json_post(
                TARGETS,
                &json!({"name": "local", "endpoint": "https://127.0.0.1:9400"}).to_string(),
            ),
        ),
        (
            "use active",
            request(Method::POST, "/__emuforge/targets/local/use")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "remove active",
            request(Method::DELETE, "/__emuforge/targets/local")
                .body(Body::empty())
                .unwrap(),
        ),
        (
            "use absent",
            request(Method::POST, "/__emuforge/targets/absent/use")
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (case, request) in cases {
        let log = captured(async {
            fixture.send(request).await;
        })
        .await;
        assert!(info_lines(&log).is_empty(), "case {case}: {log}");
    }
}

#[tokio::test]
async fn every_route_with_a_method_it_does_not_answer_is_405_with_its_allow() {
    let fixture = fixture();
    let cases = [
        (TARGETS, Method::PUT, "GET, HEAD, POST"),
        (TARGETS, Method::DELETE, "GET, HEAD, POST"),
        (
            "/__emuforge/targets/local",
            Method::POST,
            "GET, HEAD, DELETE",
        ),
        (
            "/__emuforge/targets/local",
            Method::PATCH,
            "GET, HEAD, DELETE",
        ),
        ("/__emuforge/targets/local/use", Method::GET, "POST"),
        ("/__emuforge/targets/local/use", Method::DELETE, "POST"),
        ("/__emuforge/targets/local/test", Method::GET, "POST"),
        ("/__emuforge/targets/local/test", Method::PUT, "POST"),
    ];
    for (path, method, allow) in cases {
        let case = format!("{method} {path}");
        let answer = fixture.call(method, path).await;
        answer.assert_error(StatusCode::METHOD_NOT_ALLOWED, "MethodNotAllowed", &case);
        assert_eq!(answer.headers.get(ALLOW).unwrap(), allow, "case {case}");
    }
    assert!(fixture.file_bytes().is_none());
}

#[tokio::test]
async fn no_answer_of_the_targets_routes_holds_a_key_or_the_session_token() {
    let fixture = fixture_with(Options {
        report: report(&[(Step::Credentials, Reason::CredentialsRejected)]),
        ..Options::default()
    });
    let mut answers = Vec::new();
    answers.push(
        fixture
            .add(json!({"name": "second", "endpoint": "https://127.0.0.1:9391"}))
            .await,
    );
    for (method, path) in [
        (Method::GET, TARGETS.to_owned()),
        (Method::GET, format!("{TARGETS}/local")),
        (Method::POST, format!("{TARGETS}/local/test")),
        (Method::POST, format!("{TARGETS}/second/use")),
        (Method::DELETE, format!("{TARGETS}/local")),
        (Method::GET, format!("{TARGETS}/absent")),
    ] {
        answers.push(fixture.call(method, &path).await);
    }
    for answer in answers {
        let text = format!(
            "{:?} {}",
            answer.headers,
            String::from_utf8_lossy(&answer.body)
        );
        for word in [KEY_ID, SECRET, fixture.token.as_str()] {
            assert!(!text.contains(word), "an answer holds {word}: {text}");
        }
    }
    let file = String::from_utf8(fixture.file_bytes().unwrap()).unwrap();
    assert!(!file.contains(KEY_ID) && !file.contains(SECRET), "{file}");
}

fn studio_request(method: Method, path: &str) -> axum::http::request::Builder {
    request(method, path).header(ORIGIN, STUDIO)
}

#[tokio::test]
async fn post_and_delete_from_studio_without_or_with_a_wrong_token_are_401() {
    let fixture = fixture();
    let valid = json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string();
    for (token, code) in [(None, "SessionRequired"), (Some("wrong"), "SessionInvalid")] {
        let requests = [
            ("add", Method::POST, TARGETS.to_owned(), valid.clone()),
            (
                "use",
                Method::POST,
                format!("{TARGETS}/local/use"),
                String::new(),
            ),
            (
                "remove",
                Method::DELETE,
                format!("{TARGETS}/second"),
                String::new(),
            ),
        ];
        for (case, method, path, body) in requests {
            let mut builder =
                studio_request(method, &path).header(CONTENT_TYPE, "application/json");
            if let Some(token) = token {
                builder = builder.header(SESSION_HEADER, token);
            }
            let answer = fixture.send(builder.body(Body::from(body)).unwrap()).await;
            answer.assert_error(StatusCode::UNAUTHORIZED, code, case);
            assert!(fixture.file_bytes().is_none(), "case {case}");
        }
    }
}

#[tokio::test]
async fn a_foreign_origin_or_fetch_metadata_without_origin_is_403() {
    let fixture = fixture();
    let valid = json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string();
    let cases = [
        (
            "foreign origin",
            request(Method::POST, TARGETS)
                .header(ORIGIN, "https://example.com")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(valid.clone()))
                .unwrap(),
        ),
        (
            "Sec-Fetch-Site without Origin",
            request(Method::POST, TARGETS)
                .header("sec-fetch-site", "cross-site")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(valid.clone()))
                .unwrap(),
        ),
        (
            "foreign origin, list",
            request(Method::GET, TARGETS)
                .header(ORIGIN, "https://example.com")
                .body(Body::empty())
                .unwrap(),
        ),
    ];
    for (case, request) in cases {
        let answer = fixture.send(request).await;
        answer.assert_error(StatusCode::FORBIDDEN, "OriginNotAllowed", case);
        assert!(fixture.file_bytes().is_none(), "case {case}");
    }
}

#[tokio::test]
async fn add_from_studio_with_the_token_is_201_with_the_studio_origin_allowed() {
    let fixture = fixture();
    let answer = fixture
        .send(
            studio_request(Method::POST, TARGETS)
                .header(SESSION_HEADER, fixture.token.as_str())
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"name": "second", "endpoint": "https://127.0.0.1:9400"}).to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert_eq!(answer.status, StatusCode::CREATED, "{answer:?}");
    assert_eq!(
        answer.headers.get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
        STUDIO
    );
}

#[tokio::test]
async fn preflight_from_studio_on_a_targets_path_allows_post_delete_and_content_type() {
    let fixture = fixture();
    for path in [
        TARGETS,
        "/__emuforge/targets/local",
        "/__emuforge/targets/local/use",
    ] {
        let answer = fixture
            .send(
                request(Method::OPTIONS, path)
                    .header(ORIGIN, STUDIO)
                    .header(ACCESS_CONTROL_REQUEST_METHOD, "DELETE")
                    .header(
                        ACCESS_CONTROL_REQUEST_HEADERS,
                        "content-type, x-emuforge-session",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_eq!(answer.status, StatusCode::NO_CONTENT, "path {path}");
        assert_eq!(
            answer.headers.get(ACCESS_CONTROL_ALLOW_METHODS).unwrap(),
            "GET, HEAD, POST, DELETE",
            "path {path}"
        );
        assert_eq!(
            answer.headers.get(ACCESS_CONTROL_ALLOW_HEADERS).unwrap(),
            "Content-Type, X-EmuForge-Session",
            "path {path}"
        );
    }
}
