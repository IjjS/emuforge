use std::future::Future;
use std::num::NonZeroU16;
use std::pin::Pin;
use std::sync::Arc;

use axum::error_handling::HandleErrorLayer;
use axum::extract::{Request, State};
use axum::http::header::{ALLOW, HOST, ORIGIN};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{BoxError, Json, Router};
use emuforge_core::{Emulator, Health};
use serde::Serialize;
use tower::ServiceBuilder;
use tower::limit::GlobalConcurrencyLimitLayer;

/// The engine's health route.
pub const HEALTH_PATH: &str = "/__emuforge/health";

pub type ProbeFuture = Pin<Box<dyn Future<Output = Health> + Send>>;
/// Asks the emulator whether it is up. Called once per health request; nothing is cached.
pub type ProbeFn = Arc<dyn Fn() -> ProbeFuture + Send + Sync>;

pub struct AppState {
    pub engine_port: NonZeroU16,
    pub emulator: Emulator,
    pub probe: ProbeFn,
    pub max_in_flight: usize,
}

/// The engine's service. Outermost is one in-flight bound shared by every route, fallback and refusal, then
/// the `Host` and `Origin` guards, then the routes.
pub fn app(state: AppState) -> Router {
    let max_in_flight = state.max_in_flight;
    let state = Arc::new(state);
    let routes = Router::new()
        .route(HEALTH_PATH, get(health).fallback(method_not_allowed))
        .fallback(not_found)
        .with_state(state.clone());
    // The layers wrap the router as one service, not through `Router::layer`, which wraps each route on its
    // own: the bound is global (every clone shares the one semaphore) and the guards run before routing.
    let service = ServiceBuilder::new()
        .layer(HandleErrorLayer::new(move |_: BoxError| async move {
            busy(max_in_flight)
        }))
        .load_shed()
        .layer(GlobalConcurrencyLimitLayer::new(max_in_flight))
        .layer(middleware::from_fn_with_state(state, guard))
        .service(routes);
    Router::new().fallback_service(service)
}

async fn guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let expected = format!("127.0.0.1:{}", state.engine_port);
    if !has_only_host(request.headers(), &expected) {
        return refusal(
            StatusCode::MISDIRECTED_REQUEST,
            "MisdirectedRequest",
            format!("the Host header must be {expected}; the engine answers only on that address"),
        );
    }
    if request.headers().contains_key(ORIGIN) {
        return refusal(
            StatusCode::FORBIDDEN,
            "OriginNotAllowed",
            "requests from a browser origin are not served".to_owned(),
        );
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
    let health = (state.probe)().await;
    let emulator = &state.emulator;
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

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
}

fn refusal(status: StatusCode, code: &'static str, message: String) -> Response {
    let body = ErrorBody {
        error: ErrorDetail { code, message },
    };
    (status, Json(body)).into_response()
}

fn busy(max_in_flight: usize) -> Response {
    refusal(
        StatusCode::SERVICE_UNAVAILABLE,
        "Busy",
        format!("the engine is already serving {max_in_flight} requests; retry shortly"),
    )
}

async fn not_found() -> Response {
    refusal(
        StatusCode::NOT_FOUND,
        "NotFound",
        format!("the engine has no route at this path; its health route is GET {HEALTH_PATH}"),
    )
}

async fn method_not_allowed() -> Response {
    let mut response = refusal(
        StatusCode::METHOD_NOT_ALLOWED,
        "MethodNotAllowed",
        format!("{HEALTH_PATH} accepts GET and HEAD"),
    );
    response
        .headers_mut()
        .insert(ALLOW, axum::http::HeaderValue::from_static("GET, HEAD"));
    response
}
