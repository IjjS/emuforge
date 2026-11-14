//! Browser access: the Studio origin, the browser guard (orders 3a-7 of the request path), the CORS preflight
//! answers and the CORS layer.

use std::num::NonZeroU16;
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_EXPOSE_HEADERS, ACCESS_CONTROL_MAX_AGE, ACCESS_CONTROL_REQUEST_HEADERS,
    ACCESS_CONTROL_REQUEST_METHOD, ORIGIN, VARY, WWW_AUTHENTICATE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::routes::{AppState, SESSION_PATH, refusal};

/// The request header that carries the session token. No other place of a request is read for it.
pub const SESSION_HEADER: HeaderName = HeaderName::from_static("x-emuforge-session");
/// How long a browser may keep the preflight answer.
pub const PREFLIGHT_MAX_AGE_SECS: u32 = 600;

/// Every path under this prefix, and the prefix itself, is an engine path; every other path is a relayed path.
const ENGINE_PREFIX: &str = "/__emuforge";
/// The methods a preflight on a relayed path allows: the methods AWS APIs use (D2).
const RELAYED_PREFLIGHT_METHODS: &str = "GET, HEAD, PUT, POST, DELETE, PATCH";
/// Name prefix of the browser's Fetch Metadata headers: order 3c, and removed before a Studio request is relayed
/// (D4).
const FETCH_METADATA_PREFIX: &str = "sec-fetch-";
/// Name prefix of every CORS response header; on a relayed Studio answer each one is the engine's (D5).
const CORS_PREFIX: &str = "access-control-";

/// The one origin whose browser requests the engine serves: `http://127.0.0.1:<studio port>`, always.
#[derive(Debug, Clone)]
pub struct StudioOrigin {
    value: String,
    // Digits and visible ASCII are always a valid header value, so this is always `Some`; were it `None`, the
    // CORS header would only be left off, which a browser treats as a refusal.
    header: Option<HeaderValue>,
}

impl StudioOrigin {
    pub fn new(port: NonZeroU16) -> StudioOrigin {
        let value = format!("http://127.0.0.1:{port}");
        let header = HeaderValue::try_from(value.as_str()).ok();
        StudioOrigin { value, header }
    }

    /// `http://127.0.0.1:<port>`.
    pub fn as_str(&self) -> &str {
        &self.value
    }

    /// Whether `origin` is this origin byte for byte.
    pub fn is(&self, origin: &HeaderValue) -> bool {
        origin.as_bytes() == self.value.as_bytes()
    }
}

/// `/__emuforge` or a path under `/__emuforge/`, decided on the raw path before any percent-decoding.
pub fn is_engine_path(path: &str) -> bool {
    path.strip_prefix(ENGINE_PREFIX)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// Put into the extensions of an answer of orders 1-3c (`Busy`, `MisdirectedRequest`, a browser refusal) so the
/// CORS layer adds `Vary: Origin` to it on a relayed path too. The CORS layer removes it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct EngineRefusal;

/// Marks `response` as an answer of orders 1-3c.
pub(crate) fn engine_refusal(mut response: Response) -> Response {
    response.extensions_mut().insert(EngineRefusal);
    response
}

/// Put into the extensions of a relayed-path preflight answer so the CORS layer leaves its headers as they are.
/// The CORS layer removes it.
#[derive(Debug, Clone, Copy)]
struct PreflightAnswer;

/// Where a request comes from, by its `Origin` headers.
enum Caller {
    /// No `Origin` header.
    NoOrigin,
    /// Exactly one `Origin` header, equal to the Studio origin.
    Studio,
    /// Any other `Origin`, or several `Origin` headers.
    Foreign,
}

fn caller(headers: &HeaderMap, studio: &StudioOrigin) -> Caller {
    let mut origins = headers.get_all(ORIGIN).iter();
    match (origins.next(), origins.next()) {
        (None, _) => Caller::NoOrigin,
        (Some(origin), None) if studio.is(origin) => Caller::Studio,
        _ => Caller::Foreign,
    }
}

fn has_fetch_metadata(headers: &HeaderMap) -> bool {
    headers
        .keys()
        .any(|name| name.as_str().starts_with(FETCH_METADATA_PREFIX))
}

/// The browser guard, inside the `Host` guard and around every route and the fallback.
pub(crate) async fn guard(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let studio = &state.studio_origin;
    let headers = request.headers();
    let path = request.uri().path();
    match caller(headers, studio) {
        Caller::Foreign => return engine_refusal(browser_not_served(studio)),
        Caller::NoOrigin if has_fetch_metadata(headers) => {
            return engine_refusal(browser_not_served(studio));
        }
        Caller::NoOrigin => return next.run(request).await,
        Caller::Studio => {}
    }
    let engine_path = is_engine_path(path);
    if request.method() == Method::OPTIONS && headers.contains_key(ACCESS_CONTROL_REQUEST_METHOD) {
        return if engine_path {
            preflight()
        } else {
            relayed_preflight(headers)
        };
    }
    let session_route =
        path == SESSION_PATH && matches!(*request.method(), Method::GET | Method::HEAD);
    if !session_route {
        let mut tokens = headers.get_all(&SESSION_HEADER).iter();
        match (tokens.next(), tokens.next()) {
            (None, _) => {
                return unauthorized(
                    "SessionRequired",
                    "send the session token in the X-EmuForge-Session header; obtain it from /__emuforge/session",
                );
            }
            (Some(token), None) if state.session.matches(token.as_bytes()) => {}
            _ => {
                return unauthorized(
                    "SessionInvalid",
                    "the session token is not this engine's; obtain a new one from /__emuforge/session",
                );
            }
        }
    }
    if !engine_path {
        strip_browser_headers(request.headers_mut());
    }
    next.run(request).await
}

/// Order 7: what only the browser channel adds, removed from a Studio request before it is relayed, every copy
/// of each: `Origin`, every `Sec-Fetch-*` and the session token.
fn strip_browser_headers(headers: &mut HeaderMap) {
    headers.remove(ORIGIN);
    headers.remove(&SESSION_HEADER);
    let fetch_metadata: Vec<HeaderName> = headers
        .keys()
        .filter(|name| name.as_str().starts_with(FETCH_METADATA_PREFIX))
        .cloned()
        .collect();
    for name in fetch_metadata {
        headers.remove(name);
    }
}

/// Orders 3a and 3c: a browser request from anywhere but the Studio origin.
fn browser_not_served(studio: &StudioOrigin) -> Response {
    refusal(
        StatusCode::FORBIDDEN,
        "OriginNotAllowed",
        format!(
            "requests from browsers are served only from the Studio origin {}",
            studio.as_str()
        ),
    )
}

fn unauthorized(code: &'static str, message: &str) -> Response {
    let mut response = refusal(StatusCode::UNAUTHORIZED, code, message.to_owned());
    response.headers_mut().insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_static("EmuForge-Session"),
    );
    response
}

/// The same answer to every preflight from the Studio origin on an engine path, whatever it asks for; the
/// browser then refuses any method or header not listed.
fn preflight() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let headers = response.headers_mut();
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("X-EmuForge-Session"),
    );
    headers.insert(
        ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from(PREFLIGHT_MAX_AGE_SECS),
    );
    response
}

/// The same answer to every preflight from the Studio origin on a relayed path, whatever method it asks for;
/// the headers it asks for are allowed when they are a list of header names. Nothing is forwarded.
fn relayed_preflight(headers: &HeaderMap) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.extensions_mut().insert(PreflightAnswer);
    let answer = response.headers_mut();
    answer.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(RELAYED_PREFLIGHT_METHODS),
    );
    if let Some(requested) = requested_headers(headers) {
        answer.insert(ACCESS_CONTROL_ALLOW_HEADERS, requested);
    }
    answer.insert(
        ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from(PREFLIGHT_MAX_AGE_SECS),
    );
    response
}

/// The one `Access-Control-Request-Headers` value, unchanged, when it is a list of header names: elements
/// separated by `,`, each, without the spaces and tabs around it, a non-empty run of RFC 9110 `tchar`.
fn requested_headers(headers: &HeaderMap) -> Option<HeaderValue> {
    let mut values = headers.get_all(ACCESS_CONTROL_REQUEST_HEADERS).iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return None;
    };
    let names = value
        .as_bytes()
        .split(|&b| b == b',')
        .map(trim_space_and_tab)
        .all(|name| !name.is_empty() && name.iter().all(|&b| is_tchar(b)));
    names.then(|| value.clone())
}

/// `bytes` without the spaces and tabs at either end.
fn trim_space_and_tab(bytes: &[u8]) -> &[u8] {
    let blank = |b: &u8| *b == b' ' || *b == b'\t';
    let start = bytes.iter().position(|b| !blank(b)).unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|b| !blank(b))
        .map_or(start, |end| end + 1);
    &bytes[start..end]
}

/// RFC 9110 `tchar`: `ALPHA / DIGIT / "!#$%&'*+-.^_`|~"`.
fn is_tchar(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b)
}

/// The CORS layer, outermost: on the way out, whatever answered, `Access-Control-Allow-Origin: <studio origin>`
/// when the request's one `Origin` is the Studio origin, and `Vary: Origin` on an engine path, an answer of
/// orders 1-3c, or any answer to the Studio origin. On a relayed path every other answer to the Studio origin
/// than the preflight loses the `Access-Control-*` headers it came with and exposes its own headers.
pub(crate) async fn cors(
    State(studio): State<StudioOrigin>,
    request: Request,
    next: Next,
) -> Response {
    let from_studio = matches!(caller(request.headers(), &studio), Caller::Studio);
    let engine_path = is_engine_path(request.uri().path());
    let mut response = next.run(request).await;
    let refused = response
        .extensions_mut()
        .remove::<EngineRefusal>()
        .is_some();
    let preflight = response
        .extensions_mut()
        .remove::<PreflightAnswer>()
        .is_some();
    let headers = response.headers_mut();
    if from_studio && !engine_path && !preflight {
        let upstream: Vec<HeaderName> = headers
            .keys()
            .filter(|name| name.as_str().starts_with(CORS_PREFIX))
            .cloned()
            .collect();
        for name in upstream {
            headers.remove(name);
        }
        if let Some(names) = exposed(headers) {
            headers.insert(ACCESS_CONTROL_EXPOSE_HEADERS, names);
        }
    }
    if from_studio && let Some(value) = studio.header {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    if engine_path || refused || from_studio {
        headers.append(VARY, HeaderValue::from_static("Origin"));
    }
    response
}

/// The name of every header of `headers` but `Access-Control-*` and `Vary`, lower-case, each once, sorted by
/// byte value and joined by `, `; `None` when there is none.
fn exposed(headers: &HeaderMap) -> Option<HeaderValue> {
    let mut names: Vec<&str> = headers
        .keys()
        .map(HeaderName::as_str)
        .filter(|name| !name.starts_with(CORS_PREFIX) && *name != VARY.as_str())
        .collect();
    names.sort_unstable();
    names.dedup();
    if names.is_empty() {
        return None;
    }
    // Header names are tokens, so the list is always a valid header value; were it not, the answer would only
    // expose nothing, which hides headers from the page and widens nothing.
    HeaderValue::try_from(names.join(", ")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_engine_path_raw_path_prefix_decides() {
        let cases = [
            ("/__emuforge", true),
            ("/__emuforge/", true),
            ("/__emuforge/health", true),
            ("/__emuforgex", false),
            ("/__emuforge%2Fhealth", false),
            ("/", false),
            ("/bucket/key", false),
        ];
        for (path, expected) in cases {
            assert_eq!(is_engine_path(path), expected, "case {path}");
        }
    }

    #[test]
    fn studio_origin_new_is_http_loopback_with_the_port() {
        let origin = StudioOrigin::new(NonZeroU16::new(8296).unwrap());
        assert_eq!(origin.as_str(), "http://127.0.0.1:8296");
        assert!(origin.is(&HeaderValue::from_static("http://127.0.0.1:8296")));
        assert!(!origin.is(&HeaderValue::from_static("http://127.0.0.1:82960")));
    }
}
