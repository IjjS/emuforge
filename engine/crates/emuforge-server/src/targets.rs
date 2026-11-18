//! The targets API under `/__emuforge/targets`: list, add, info, use, test and remove the emulator connections
//! kept in the settings file. Every route sits inside the engine's in-flight bound, `Host` guard and browser
//! guard; every refusal is #1's JSON shape. No answer holds a key, a token or a file's content.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, Request, State};
use axum::http::header::{ALLOW, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodRouter, get, post};
use axum::{Json, Router};
use emuforge_core::{
    ChangeError, Emulator, Health, Outcome, Reason, Settings, SettingsError, Step, Target,
    TargetError, TargetName, TestReport,
};
use http_body::Body as _;
use serde::Serialize;

use crate::config::Form;
use crate::routes::{AppState, refusal, settings_unusable};

/// The targets API's collection route.
pub const TARGETS_PATH: &str = "/__emuforge/targets";
/// The largest body `add` reads.
pub const ADD_BODY_CAP: usize = 4 * 1024;

pub type TestFuture = Pin<Box<dyn Future<Output = TestReport> + Send>>;
/// Runs a target's test against its emulator. Called once per test request; production holds
/// `emuforge_core::check::test` with the probe's deadline.
pub type TestFn = Arc<dyn Fn(Emulator) -> TestFuture + Send + Sync>;

/// The targets routes, each with its own `405` and `Allow`.
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            TARGETS_PATH,
            with_allow(get(list).post(add), "GET, HEAD, POST"),
        )
        .route(
            "/__emuforge/targets/{name}",
            with_allow(get(info).delete(remove), "GET, HEAD, DELETE"),
        )
        .route(
            "/__emuforge/targets/{name}/use",
            with_allow(post(use_target), "POST"),
        )
        .route(
            "/__emuforge/targets/{name}/test",
            with_allow(post(test), "POST"),
        )
}

fn with_allow(
    router: MethodRouter<Arc<AppState>>,
    allow: &'static str,
) -> MethodRouter<Arc<AppState>> {
    router.fallback(move || async move {
        let mut response = refusal(
            StatusCode::METHOD_NOT_ALLOWED,
            "MethodNotAllowed",
            format!("this path accepts {allow}"),
        );
        response
            .headers_mut()
            .insert(ALLOW, HeaderValue::from_static(allow));
        response
    })
}

/// `<target>`: its fields and whether it is the active one.
#[derive(Serialize)]
struct TargetView<'a> {
    #[serde(flatten)]
    target: &'a Target,
    active: bool,
}

#[derive(Serialize)]
struct ListView<'a> {
    active: &'a TargetName,
    targets: Vec<TargetView<'a>>,
}

fn view<'a>(settings: &'a Settings, target: &'a Target) -> TargetView<'a> {
    TargetView {
        target,
        active: settings.active().name() == target.name(),
    }
}

fn list_view(settings: &Settings) -> Response {
    let body = ListView {
        active: settings.active().name(),
        targets: settings
            .targets()
            .iter()
            .map(|target| view(settings, target))
            .collect(),
    };
    (StatusCode::OK, Json(body)).into_response()
}

/// `GET` and `HEAD /__emuforge/targets`.
async fn list(State(state): State<Arc<AppState>>) -> Response {
    match state.settings.load().await {
        Ok(settings) => list_view(&settings),
        Err(error) => settings_unusable(&error),
    }
}

/// `POST /__emuforge/targets`. The Compose form is refused before anything of the request is read.
async fn add(State(state): State<Arc<AppState>>, request: Request) -> Response {
    if state.form == Form::Compose {
        return refusal(
            StatusCode::FORBIDDEN,
            "ComposeHoldsOneTarget",
            "the Compose form holds one target, its own emulator; adding a target is not possible there"
                .to_owned(),
        );
    }
    let (parts, body) = request.into_parts();
    if !is_json(&parts.headers) {
        return refusal(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UnsupportedMediaType",
            "a target is sent as JSON with Content-Type: application/json".to_owned(),
        );
    }
    let Some(bytes) = read_capped(&parts.headers, body).await else {
        return refusal(
            StatusCode::PAYLOAD_TOO_LARGE,
            "BodyTooLarge",
            format!("a target is at most {ADD_BODY_CAP} bytes of JSON"),
        );
    };
    let target = match serde_json::from_slice(&bytes)
        .map_err(|_| TargetError::Invalid {
            field: "body".to_owned(),
            why: "the request body is not JSON".to_owned(),
        })
        .and_then(|value| Target::from_json(&value))
    {
        Ok(target) => target,
        Err(error) => return target_refusal(&error),
    };
    let port = target.endpoint().port();
    if port == state.engine_port || port == state.studio_port {
        return target_refusal(&TargetError::Invalid {
            field: "endpoint".to_owned(),
            why: format!("the port {port} is the engine's or Studio's own port"),
        });
    }
    let added = target.clone();
    let changed = state
        .settings
        .change(move |settings| {
            settings.add(added)?;
            Ok(true)
        })
        .await;
    match changed {
        Ok(settings) => {
            tracing::info!(
                change = "add",
                name = %target.name(),
                endpoint = %target.endpoint(),
                "target added"
            );
            (StatusCode::CREATED, Json(view(&settings, &target))).into_response()
        }
        Err(error) => change_refusal(&error),
    }
}

/// `application/json`, parameters (a charset) allowed.
fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|essence| essence.trim().eq_ignore_ascii_case("application/json"))
}

/// The whole body when it is at most [`ADD_BODY_CAP`] bytes, by its `Content-Length` before reading and by what
/// arrives while reading; `None` past the cap or when the body fails.
async fn read_capped(headers: &HeaderMap, mut body: Body) -> Option<Bytes> {
    let declared = headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if declared.is_some_and(|length| length > ADD_BODY_CAP as u64) {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(frame) = std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx)).await {
        let Ok(data) = frame.ok()?.into_data() else {
            continue;
        };
        if bytes.len() + data.len() > ADD_BODY_CAP {
            return None;
        }
        bytes.extend_from_slice(&data);
    }
    Some(Bytes::from(bytes))
}

#[derive(Serialize)]
struct InfoView<'a> {
    #[serde(flatten)]
    target: TargetView<'a>,
    credentials_dir: String,
    health: HealthView,
}

#[derive(Serialize)]
struct HealthView {
    reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// `GET` and `HEAD /__emuforge/targets/<name>`: the target, where its keys are, and its emulator's health now.
async fn info(
    State(state): State<Arc<AppState>>,
    name: Result<Path<String>, PathRejection>,
) -> Response {
    let settings = match state.settings.load().await {
        Ok(settings) => settings,
        Err(error) => return settings_unusable(&error),
    };
    let target = match found(&settings, name) {
        Ok(target) => target,
        Err(error) => return target_refusal(&error),
    };
    let emulator = Emulator::for_endpoint(&state.home, target.endpoint());
    let health = match (state.probe)(emulator.clone()).await {
        Health::Reachable => HealthView {
            reachable: true,
            reason: None,
            message: None,
        },
        Health::Unreachable(reason) => HealthView {
            reachable: false,
            reason: Some(reason.code()),
            message: Some(reason.message(&emulator)),
        },
    };
    let body = InfoView {
        target: view(&settings, target),
        credentials_dir: format!("~/.aws/emulator/{}/", target.endpoint().port()),
        health,
    };
    (StatusCode::OK, Json(body)).into_response()
}

/// `POST /__emuforge/targets/<name>/use`. Using the active one again writes nothing.
async fn use_target(
    State(state): State<Arc<AppState>>,
    name: Result<Path<String>, PathRejection>,
) -> Response {
    let name = match parse_name(name) {
        Ok(name) => name,
        Err(error) => return target_refusal(&error),
    };
    let mut changed = false;
    let result = state
        .settings
        .change(|settings| {
            changed = settings.use_target(&name)?;
            Ok(changed)
        })
        .await;
    match result {
        Ok(settings) => {
            if changed {
                tracing::info!(
                    change = "use",
                    name = %name,
                    endpoint = %settings.active().endpoint(),
                    "target used"
                );
            }
            list_view(&settings)
        }
        Err(error) => change_refusal(&error),
    }
}

#[derive(Serialize)]
struct TestView<'a> {
    name: &'a TargetName,
    endpoint: String,
    passed: bool,
    checks: Vec<CheckView>,
}

#[derive(Serialize)]
struct CheckView {
    check: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// `POST /__emuforge/targets/<name>/test`. A failed test is still `200`: it is the test's answer.
async fn test(
    State(state): State<Arc<AppState>>,
    name: Result<Path<String>, PathRejection>,
) -> Response {
    let settings = match state.settings.load().await {
        Ok(settings) => settings,
        Err(error) => return settings_unusable(&error),
    };
    let target = match found(&settings, name) {
        Ok(target) => target,
        Err(error) => return target_refusal(&error),
    };
    let emulator = Emulator::for_endpoint(&state.home, target.endpoint());
    let report = (state.test)(emulator.clone()).await;
    let checks = report
        .checks
        .iter()
        .map(|(step, outcome)| CheckView {
            check: step.name(),
            status: outcome.status(),
            reason: outcome.reason().map(|reason| reason.code()),
            message: match outcome {
                Outcome::Failed(reason) => Some(step_message(*step, reason, &emulator)),
                Outcome::Passed | Outcome::NotRun => None,
            },
        })
        .collect();
    let body = TestView {
        name: target.name(),
        endpoint: target.endpoint().to_string(),
        passed: report.passed(),
        checks,
    };
    (StatusCode::OK, Json(body)).into_response()
}

/// A failed step's message. The shared reason's message names the health route; the `credentials` step sent the
/// signed STS request instead, so an unexpected status there names that request.
fn step_message(step: Step, reason: &Reason, emulator: &Emulator) -> String {
    match (step, reason) {
        (Step::Credentials, Reason::UnexpectedResponse { status }) => format!(
            "the emulator on {} answered the signed STS GetCallerIdentity with status {status}, not 200",
            emulator.endpoint()
        ),
        _ => reason.message(emulator),
    }
}

/// `DELETE /__emuforge/targets/<name>`. The emulator is not touched.
async fn remove(
    State(state): State<Arc<AppState>>,
    name: Result<Path<String>, PathRejection>,
) -> Response {
    let name = match parse_name(name) {
        Ok(name) => name,
        Err(error) => return target_refusal(&error),
    };
    let mut endpoint = None;
    let result = state
        .settings
        .change(|settings| {
            endpoint = Some(settings.get(&name)?.endpoint().to_string());
            settings.remove(&name)?;
            Ok(true)
        })
        .await;
    match result {
        Ok(_) => {
            tracing::info!(
                change = "remove",
                name = %name,
                endpoint = endpoint.as_deref().unwrap_or_default(),
                "target removed"
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => change_refusal(&error),
    }
}

/// The path's name; one that breaks the name rule is not found, since no target can have it.
fn parse_name(name: Result<Path<String>, PathRejection>) -> Result<TargetName, TargetError> {
    let text = name.map(|Path(text)| text).unwrap_or_default();
    TargetName::parse(&text).map_err(|_| TargetError::NotFound { name: text })
}

fn found(
    settings: &Settings,
    name: Result<Path<String>, PathRejection>,
) -> Result<&Target, TargetError> {
    settings.get(&parse_name(name)?)
}

fn change_refusal(error: &ChangeError) -> Response {
    match error {
        ChangeError::Target(error) => target_refusal(error),
        ChangeError::Settings(error @ SettingsError::WriteFailed { .. }) => {
            tracing::warn!("{error}");
            refusal(
                StatusCode::INTERNAL_SERVER_ERROR,
                "SettingsWriteFailed",
                error.to_string(),
            )
        }
        ChangeError::Settings(error) => settings_unusable(error),
    }
}

fn target_refusal(error: &TargetError) -> Response {
    let (status, code) = match error {
        TargetError::Invalid { .. } => (StatusCode::BAD_REQUEST, "TargetInvalid"),
        TargetError::NotLoopback => (StatusCode::BAD_REQUEST, "EndpointNotLoopback"),
        TargetError::Exists { .. } => (StatusCode::CONFLICT, "TargetExists"),
        TargetError::Limit => (StatusCode::CONFLICT, "TargetLimit"),
        TargetError::NotFound { .. } => (StatusCode::NOT_FOUND, "TargetNotFound"),
        TargetError::Active { .. } => (StatusCode::CONFLICT, "TargetActive"),
    };
    refusal(status, code, error.to_string())
}
