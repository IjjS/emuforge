use std::future::Future;
use std::num::NonZeroU16;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{ALLOW, CACHE_CONTROL, CONNECTION, HOST, ORIGIN, WWW_AUTHENTICATE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use emuforge_core::chunked::CHUNK_DATA_CAP;
use emuforge_core::sigv4::{Auth, classify};
use emuforge_core::{
    Emulator, Health, Limits, Reason, RelayBody, RelayError, SettingsError, Store, TargetName,
};
use serde::Serialize;
use tower::ServiceBuilder;

use crate::aws_error::{ErrorType, Protocol, render};
use crate::browser::{self, StudioOrigin, engine_refusal, is_engine_path};
use crate::channel::{self, ChannelRequest};
use crate::config::Form;
use crate::hosts::AcceptedHosts;
use crate::limit::{InFlight, limit};
use crate::session::SessionToken;
use crate::targets::{self, TestFn};

/// The engine's health route.
pub const HEALTH_PATH: &str = "/__emuforge/health";
/// The route that gives the session token to the Studio origin.
pub const SESSION_PATH: &str = "/__emuforge/session";

pub type ProbeFuture = Pin<Box<dyn Future<Output = Health> + Send>>;
/// Asks the active target's emulator whether it is up. Called once per health request; nothing is cached.
pub type ProbeFn = Arc<dyn Fn(Emulator) -> ProbeFuture + Send + Sync>;

pub type RelayFuture =
    Pin<Box<dyn Future<Output = Result<Response<RelayBody>, RelayError>> + Send>>;
/// Relays one request to the active target's emulator. Called once per request on a relayed path; production
/// holds `emuforge_core::relay` with the emulator's files read per call.
pub type RelayFn = Arc<dyn Fn(Emulator, Request<Body>) -> RelayFuture + Send + Sync>;

pub struct AppState {
    pub engine_port: NonZeroU16,
    pub studio_port: NonZeroU16,
    pub form: Form,
    /// The emulators' files are under `<home>/.aws/emulator/<port>/`.
    pub home: PathBuf,
    /// The targets; the active one is read at every health and every relayed request.
    pub settings: Arc<Store>,
    pub probe: ProbeFn,
    pub relay: RelayFn,
    /// Runs a target's test; called once per test request.
    pub test: TestFn,
    pub max_in_flight: usize,
    pub studio_origin: StudioOrigin,
    pub session: Arc<SessionToken>,
    /// The `Host` headers Studio's port accepts, read by the channel's guard.
    pub accepted_hosts: AcceptedHosts,
}

/// The engine's two ways in over one state and one in-flight bound: the engine port's service, and the channel
/// Studio's server hands `/__engine` requests to.
pub struct Apps {
    pub engine: Router,
    pub channel: Router,
}

/// The engine port's service: `apps(state).engine`.
pub fn app(state: AppState) -> Router {
    apps(state).engine
}

/// Both services over the one route table. The engine port's: outermost the CORS layer, then the in-flight
/// bound, then the `Host` guard, then the browser guard around the routes and the relay. The channel's: the inner
/// path, the answer headers, the same in-flight bound, then the channel's guard around the same routes.
pub fn apps(state: AppState) -> Apps {
    let in_flight = InFlight::new(state.max_in_flight);
    let studio_origin = state.studio_origin.clone();
    let state = Arc::new(state);
    let table = Router::new()
        .route(
            HEALTH_PATH,
            get(health).fallback(|| method_not_allowed(HEALTH_PATH)),
        )
        .route(
            SESSION_PATH,
            get(session).fallback(|| method_not_allowed(SESSION_PATH)),
        )
        .merge(targets::routes())
        .fallback(fallback);
    // Each guard wraps every route and the fallback, method fallbacks included, so the token is checked before a
    // method is refused.
    let engine_routes = table
        .clone()
        .layer(middleware::from_fn_with_state(
            state.clone(),
            browser::guard,
        ))
        .layer(middleware::from_fn(shape_refusals))
        .with_state(state.clone());
    let channel_routes = table
        .layer(middleware::from_fn_with_state(
            state.clone(),
            channel::guard,
        ))
        .layer(middleware::from_fn(shape_refusals))
        .with_state(state.clone());
    // The other layers wrap each router as one service, not through `Router::layer`, which wraps each route on
    // its own: the bound is global (every clone shares the one semaphore), the `Host` guard and the inner path
    // run before routing, and the outermost layer sees every answer, `Busy` included.
    let engine = ServiceBuilder::new()
        .layer(middleware::from_fn_with_state(studio_origin, browser::cors))
        .layer(middleware::from_fn_with_state(in_flight.clone(), limit))
        .layer(middleware::from_fn_with_state(state, host_guard))
        .service(engine_routes);
    let channel = ServiceBuilder::new()
        .layer(middleware::from_fn(channel::inner_path))
        .layer(middleware::from_fn(channel::answer_headers))
        .layer(middleware::from_fn_with_state(in_flight, limit))
        .service(channel_routes);
    Apps {
        engine: Router::new().fallback_service(engine),
        channel: Router::new().fallback_service(channel),
    }
}

/// Order 2: exactly one `Host` equal to the engine's address, a request target in origin form, and not
/// `CONNECT`; the engine is never a proxy.
async fn host_guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let expected = format!("127.0.0.1:{}", state.engine_port);
    let uri = request.uri();
    let origin_form =
        uri.scheme().is_none() && uri.authority().is_none() && uri.path().starts_with('/');
    if !has_only_host(request.headers(), &expected)
        || !origin_form
        || request.method() == Method::CONNECT
    {
        let (parts, _body) = request.into_parts();
        let misdirected = refusal(
            StatusCode::MISDIRECTED_REQUEST,
            "MisdirectedRequest",
            format!("the Host header must be {expected}; the engine answers only on that address"),
        );
        return engine_refusal(Shape::of(&parts).apply(misdirected));
    }
    next.run(request).await
}

/// Exactly one `Host` header, equal to `expected`.
fn has_only_host(headers: &HeaderMap, expected: &str) -> bool {
    let mut hosts = headers.get_all(HOST).iter();
    match (hosts.next(), hosts.next()) {
        (Some(host), None) => host.as_bytes() == expected.as_bytes(),
        _ => false,
    }
}

#[derive(Serialize)]
struct HealthBody {
    target: TargetName,
    emulator: EmulatorHealth,
}

#[derive(Serialize)]
struct EmulatorHealth {
    port: u16,
    endpoint: String,
    reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// `GET` and `HEAD`; axum answers `HEAD` with the same status and headers and no body.
async fn health(State(state): State<Arc<AppState>>) -> Response {
    let (target, emulator) = match active(&state).await {
        Ok(active) => active,
        Err(error) => return settings_unusable(&error),
    };
    let health = (state.probe)(emulator.clone()).await;
    let emulator = &emulator;
    let (status, reason, message) = match health {
        Health::Reachable => (StatusCode::OK, None, None),
        Health::Unreachable(reason) => {
            tracing::debug!(reason = reason.code(), "emulator unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Some(reason.code()),
                Some(reason.message(emulator)),
            )
        }
    };
    let body = HealthBody {
        target,
        emulator: EmulatorHealth {
            port: emulator.port().get(),
            endpoint: emulator.endpoint(),
            reachable: reason.is_none(),
            reason,
            message,
        },
    };
    (status, Json(body)).into_response()
}

/// The active target's name and its emulator, read from the settings file now.
pub(crate) async fn active(state: &AppState) -> Result<(TargetName, Emulator), SettingsError> {
    let settings = state.settings.load().await?;
    let target = settings.active();
    Ok((
        target.name().clone(),
        Emulator::for_endpoint(&state.home, target.endpoint()),
    ))
}

/// `503 SettingsUnusable`: the settings file cannot be used; the message names it and says to fix or remove it.
pub(crate) fn settings_unusable(error: &SettingsError) -> Response {
    tracing::debug!("{error}");
    refusal(
        StatusCode::SERVICE_UNAVAILABLE,
        "SettingsUnusable",
        error.to_string(),
    )
}

#[derive(Serialize)]
struct SessionBody<'a> {
    token: &'a str,
}

/// `GET` and `HEAD`. On the engine port the browser guard has let through only the Studio origin or a request
/// without `Origin` and without `Sec-Fetch-*`; the latter is order 5. On the channel its guard has let the request
/// through and marked it.
async fn session(State(state): State<Arc<AppState>>, request: Request) -> Response {
    let channel = request.extensions().get::<ChannelRequest>().is_some();
    if !channel && !request.headers().contains_key(ORIGIN) {
        return refusal(
            StatusCode::FORBIDDEN,
            "OriginNotAllowed",
            format!(
                "the session is given only to the Studio origin {}",
                state.studio_origin.as_str()
            ),
        );
    }
    let body = SessionBody {
        token: state.session.expose(),
    };
    let mut response = (StatusCode::OK, Json(body)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
}

/// The code and message of an engine refusal, kept in its extensions so that on a relayed path it can be
/// answered again in the caller's protocol. It never reaches the wire.
#[derive(Debug, Clone)]
struct Refused {
    code: &'static str,
    message: String,
}

/// An engine refusal in #1's JSON shape.
pub(crate) fn refusal(status: StatusCode, code: &'static str, message: String) -> Response {
    let body = ErrorBody {
        error: ErrorDetail {
            code,
            message: message.clone(),
        },
    };
    let mut response = (status, Json(body)).into_response();
    response.extensions_mut().insert(Refused { code, message });
    response
}

/// The shape of an engine refusal for one request: #1's JSON on an engine path, the caller's protocol on a
/// relayed path (requirement §6, D7). The guard that refuses decides the status and the code; this decides only
/// the shape.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Shape {
    relayed: Option<Protocol>,
    head_only: bool,
}

impl Shape {
    pub(crate) fn of(parts: &Parts) -> Shape {
        Shape {
            relayed: (!is_engine_path(parts.uri.path())).then(|| Protocol::detect(parts)),
            head_only: parts.method == Method::HEAD,
        }
    }

    /// `response` again in the caller's protocol when it is an engine refusal on a relayed path, with its
    /// status, its extensions (the `EngineRefusal` marker among them) and its `WWW-Authenticate`; any other
    /// response unchanged.
    pub(crate) fn apply(self, mut response: Response) -> Response {
        let Some(protocol) = self.relayed else {
            return response;
        };
        let Some(refused) = response.extensions_mut().remove::<Refused>() else {
            return response;
        };
        let status = response.status();
        let mut shaped = render(
            protocol,
            status,
            refused.code,
            ErrorType::for_status(status),
            &refused.message,
            self.head_only,
        );
        *shaped.extensions_mut() = std::mem::take(response.extensions_mut());
        if let Some(challenge) = response.headers_mut().remove(WWW_AUTHENTICATE) {
            shaped.headers_mut().insert(WWW_AUTHENTICATE, challenge);
        }
        shaped
    }
}

/// Around the browser guard: its refusals on a relayed path take the caller's protocol.
async fn shape_refusals(request: Request, next: Next) -> Response {
    let (parts, body) = request.into_parts();
    let shape = Shape::of(&parts);
    shape.apply(next.run(Request::from_parts(parts, body)).await)
}

/// `/__emuforge` and every path under it that has no route is the engine's `404`; every other path is relayed.
async fn fallback(State(state): State<Arc<AppState>>, request: Request) -> Response {
    if is_engine_path(request.uri().path()) {
        return not_found().await;
    }
    relay(&state, request).await
}

/// One relayed request to the target active at its start: the emulator's answer as it came, or the engine's own
/// error in the caller's protocol.
async fn relay(state: &AppState, request: Request) -> Response {
    let started = Instant::now();
    let (parts, body) = request.into_parts();
    let emulator = match active(state).await {
        Ok((_, emulator)) => emulator,
        Err(error) => return Shape::of(&parts).apply(settings_unusable(&error)),
    };
    let protocol = Protocol::detect(&parts);
    let head_only = parts.method == Method::HEAD;
    let method = parts.method.clone();
    let service = logged_service(&parts);
    let relayed = (state.relay)(emulator.clone(), Request::from_parts(parts, body)).await;
    let (response, outcome) = match relayed {
        Ok(response) => (response.map(Body::new), "relayed"),
        Err(error) => relay_error(&emulator, protocol, head_only, &error),
    };
    tracing::debug!(
        method = method.as_str(),
        service,
        status = response.status().as_u16(),
        outcome,
        elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "relayed request"
    );
    response
}

/// The credential scope's service when it is a plain service name, `-` when the request is not signed, `?`
/// for anything else; nothing else from the request is logged.
fn logged_service(parts: &Parts) -> String {
    match classify(parts) {
        Auth::Header(client) | Auth::Query(client) => {
            let service = client.scope.service;
            let plain = !service.is_empty()
                && service.len() <= 32
                && service
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if plain { service } else { "?".to_owned() }
        }
        Auth::Other => "-".to_owned(),
    }
}

/// The engine's own answer to a relay that failed before the emulator's response head (issue #2 requirement §6
/// rows 5-9, and issue #9's chunk above the cap). Rows 6-9, a failed client body and a chunk above the cap close
/// the client connection after the answer.
fn relay_error(
    emulator: &Emulator,
    protocol: Protocol,
    head_only: bool,
    error: &RelayError,
) -> (Response, &'static str) {
    let endpoint = emulator.endpoint();
    let limits = Limits::DEFAULT;
    let (status, code, message, close) = match error {
        RelayError::ChunkTooLarge => (
            StatusCode::BAD_REQUEST,
            "ChunkTooLarge",
            format!(
                "a chunk of the aws-chunked request body is larger than {CHUNK_DATA_CAP} bytes, the most the engine relays in one chunk; upload with smaller chunks"
            ),
            true,
        ),
        RelayError::Unavailable(reason) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "EmulatorUnavailable",
            format!(
                "the emulator at {endpoint} is not reachable ({}): {}",
                reason.code(),
                reason.message(emulator)
            ),
            matches!(reason, Reason::ConnectionFailed { .. }),
        ),
        RelayError::ClientStalled => (
            StatusCode::REQUEST_TIMEOUT,
            "RequestTimeout",
            format!(
                "no request body byte arrived for {} s",
                limits.upload_idle.as_secs()
            ),
            true,
        ),
        RelayError::EmulatorStalled => (
            StatusCode::GATEWAY_TIMEOUT,
            "EmulatorTimeout",
            format!(
                "the emulator at {endpoint} did not answer within {} s",
                limits.upload_idle.as_secs()
            ),
            true,
        ),
        RelayError::HeadTimeout => (
            StatusCode::GATEWAY_TIMEOUT,
            "EmulatorTimeout",
            format!(
                "the emulator at {endpoint} did not answer within {} s",
                limits.head.as_secs()
            ),
            true,
        ),
        RelayError::ClientBodyFailed => (
            StatusCode::BAD_REQUEST,
            "IncompleteBody",
            "the request body ended in an error before it was complete".to_owned(),
            true,
        ),
    };
    let mut response = render(
        protocol,
        status,
        code,
        ErrorType::for_status(status),
        &message,
        head_only,
    );
    if close {
        response
            .headers_mut()
            .insert(CONNECTION, HeaderValue::from_static("close"));
    }
    (response, code)
}

async fn not_found() -> Response {
    refusal(
        StatusCode::NOT_FOUND,
        "NotFound",
        format!("the engine has no route at this path; its health route is GET {HEALTH_PATH}"),
    )
}

async fn method_not_allowed(path: &'static str) -> Response {
    let mut response = refusal(
        StatusCode::METHOD_NOT_ALLOWED,
        "MethodNotAllowed",
        format!("{path} accepts GET and HEAD"),
    );
    response
        .headers_mut()
        .insert(ALLOW, HeaderValue::from_static("GET, HEAD"));
    response
}
