//! The channel (issue 503): `/__engine` on Studio's port, a way to the engine's routes and relay for the page
//! Studio serves, in the same process, under its own guard. A request is handed to it by Studio's server with the
//! raw path it came with; its layers, outermost first, are the inner path, the answer headers, the engine's one
//! in-flight bound, the guard (rows 2 to 6 of requirement 3.4), and the engine's routes and relay.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header::{ORIGIN, VARY, X_CONTENT_TYPE_OPTIONS};
use axum::http::uri::{PathAndQuery, Uri};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::browser::{
    CORS_PREFIX, FETCH_METADATA_PREFIX, SESSION_HEADER, VARY_SESSION, is_engine_path,
    session_invalid, session_required,
};
use crate::hosts::AcceptedHost;
use crate::routes::{AppState, SESSION_PATH, Shape, refusal};

/// The channel's path on Studio's port: this path and every path under it, decided on the raw path.
pub const CHANNEL_PATH: &str = "/__engine";

const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");
const SEC_FETCH_SITE: HeaderName = HeaderName::from_static("sec-fetch-site");
/// Headers a forwarder adds, removed before a request reaches the routes (requirement 3.4).
const FORWARDER_HEADERS: [HeaderName; 3] = [
    HeaderName::from_static("forwarded"),
    HeaderName::from_static("x-real-ip"),
    HeaderName::from_static("via"),
];
/// Name prefixes of headers a forwarder adds, every one removed.
const FORWARDER_PREFIXES: [&str; 2] = ["x-forwarded-", "tailscale-"];

/// `/__engine` or a path under `/__engine/`, raw, before any percent-decoding: `/__enginex` and `/__engine%2Fx`
/// are not.
pub(crate) fn is_channel_path(path: &str) -> bool {
    path.strip_prefix(CHANNEL_PATH)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// Put into a request's extensions by the guard once it has passed rows 2 to 6; the session route then gives the
/// token. Only the guard inserts it; nothing a caller sends becomes it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ChannelRequest;

/// Order 0: the request target becomes the inner path, the raw bytes after `/__engine` (`/` for `/__engine`
/// itself), never decoded or encoded again, and the query byte for byte. A scheme and authority stay, so the
/// guard sees a target that is not in origin form.
pub(crate) async fn inner_path(mut request: Request, next: Next) -> Response {
    if let Some(uri) = inner_uri(request.uri()) {
        *request.uri_mut() = uri;
    }
    next.run(request).await
}

fn inner_uri(uri: &Uri) -> Option<Uri> {
    let target = uri.path_and_query()?.as_str();
    let rest = target.strip_prefix(CHANNEL_PATH)?;
    let inner = if rest.starts_with('/') {
        rest.to_owned()
    } else {
        format!("/{rest}")
    };
    let mut parts = uri.clone().into_parts();
    parts.path_and_query = Some(PathAndQuery::try_from(inner).ok()?);
    Uri::from_parts(parts).ok()
}

/// Order 1: on every answer, no `Access-Control-*` header, `Cross-Origin-Resource-Policy: same-origin`,
/// `X-Content-Type-Options: nosniff` where the answer has none, and `Vary: Origin` and `Vary: X-EmuForge-Session`
/// appended.
pub(crate) async fn answer_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    remove_by_prefix(headers, &[CORS_PREFIX]);
    headers.insert(
        CROSS_ORIGIN_RESOURCE_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    if !headers.contains_key(X_CONTENT_TYPE_OPTIONS) {
        headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    }
    headers.append(VARY, HeaderValue::from_static("Origin"));
    headers.append(VARY, HeaderValue::from_static(VARY_SESSION));
    response
}

/// Order 3: rows 2 to 6 of requirement 3.4, in that order; then the browser's and the forwarder's headers are
/// removed, the session token too on a relayed path, and the request is marked as the channel's.
pub(crate) async fn guard(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let (parts, body) = request.into_parts();
    let shape = Shape::of(&parts);
    let origin_form = parts.uri.scheme().is_none()
        && parts.uri.authority().is_none()
        && parts.uri.path().starts_with('/');
    let host = state
        .accepted_hosts
        .accept(&parts.headers)
        .filter(|_| origin_form && parts.method != Method::CONNECT);
    let Some(host) = host else {
        return shape.apply(misdirected(&state));
    };
    if !same_origin(&parts.headers, &host) {
        return shape.apply(not_same_origin(&host));
    }
    let path = parts.uri.path();
    let session_route = path == SESSION_PATH && matches!(parts.method, Method::GET | Method::HEAD);
    if !session_route {
        let mut tokens = parts.headers.get_all(&SESSION_HEADER).iter();
        let refused = match (tokens.next(), tokens.next()) {
            (None, _) => Some(session_required()),
            (Some(token), None) if state.session.matches(token.as_bytes()) => None,
            _ => Some(session_invalid()),
        };
        if let Some(refused) = refused {
            return shape.apply(refused);
        }
    }
    let relayed = !is_engine_path(path);
    request = Request::from_parts(parts, body);
    let headers = request.headers_mut();
    headers.remove(ORIGIN);
    for name in FORWARDER_HEADERS {
        headers.remove(name);
    }
    remove_by_prefix(headers, &[FETCH_METADATA_PREFIX]);
    remove_by_prefix(headers, &FORWARDER_PREFIXES);
    if relayed {
        headers.remove(&SESSION_HEADER);
    }
    request.extensions_mut().insert(ChannelRequest);
    next.run(request).await
}

/// Rows 3 and 4: no `Origin`, or exactly one equal to `http://<Host>` (also `https://<Host>` when `Host` matched an
/// allowed name), after ASCII lower-casing; and every `Sec-Fetch-Site` header `same-origin`.
fn same_origin(headers: &HeaderMap, host: &AcceptedHost) -> bool {
    let mut origins = headers.get_all(ORIGIN).iter();
    let origin_ok = match (origins.next(), origins.next()) {
        (None, _) => true,
        (Some(origin), None) => origin.to_str().is_ok_and(|origin| {
            let origin = origin.to_ascii_lowercase();
            let own = Some(host.as_str());
            origin.strip_prefix("http://") == own
                || (host.is_allowed_name() && origin.strip_prefix("https://") == own)
        }),
        _ => false,
    };
    origin_ok
        && headers
            .get_all(SEC_FETCH_SITE)
            .iter()
            .all(|site| site.as_bytes() == b"same-origin")
}

fn misdirected(state: &AppState) -> Response {
    refusal(
        StatusCode::MISDIRECTED_REQUEST,
        "MisdirectedRequest",
        format!(
            "the engine is reached through Studio only at {} or a host name allowed with --allow-host",
            state.accepted_hosts.loopback()
        ),
    )
}

fn not_same_origin(host: &AcceptedHost) -> Response {
    refusal(
        StatusCode::FORBIDDEN,
        "OriginNotAllowed",
        format!(
            "browser requests are served only from the page's own origin; this request came with Host {}, and \
             whatever forwards to Studio must pass the browser's Host header on unchanged",
            host.as_str()
        ),
    )
}

/// Removes every header whose name starts with one of `prefixes`, every copy.
fn remove_by_prefix(headers: &mut HeaderMap, prefixes: &[&str]) {
    let names: Vec<HeaderName> = headers
        .keys()
        .filter(|name| {
            prefixes
                .iter()
                .any(|prefix| name.as_str().starts_with(prefix))
        })
        .cloned()
        .collect();
    for name in names {
        headers.remove(name);
    }
}
