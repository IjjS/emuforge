//! Studio's server (issue 484): Studio's production build, held in memory, answered on Studio's own listener as
//! Studio's dev server (`studio/scripts/serve.ts`) answers it. It knows nothing of the engine but its port: no
//! session, no relay, no CORS header, and no request reaches the filesystem (P4).

use std::collections::BTreeMap;
use std::fmt;
use std::num::NonZeroU16;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::header::{
    ALLOW, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, HOST, HeaderName, REFERRER_POLICY,
    X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;

use crate::Error;
use crate::limit::{InFlight, hold};

/// The content type of a built file by its extension: the table of `serve.ts`, verbatim. Any other extension, or
/// none, is `application/octet-stream`.
pub const STUDIO_CONTENT_TYPES: &[(&str, &str)] = &[
    (".html", "text/html; charset=utf-8"),
    (".js", "text/javascript; charset=utf-8"),
    (".css", "text/css; charset=utf-8"),
    (".json", "application/json"),
    (".map", "application/json"),
    (".svg", "image/svg+xml"),
    (".png", "image/png"),
    (".ico", "image/x-icon"),
    (".woff", "font/woff"),
    (".woff2", "font/woff2"),
    (".txt", "text/plain; charset=utf-8"),
];

const OCTET_STREAM: &str = "application/octet-stream";
const TEXT: &str = "text/plain; charset=utf-8";
const INDEX: &str = "index.html";
const CONFIG_PATH: &str = "/config.json";
/// Vite puts every built asset here, each with a hashed name; a missing one is a `404`, never the page.
const ASSETS_PREFIX: &str = "/assets/";
/// Vite's hashed assets never change.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// Every other file keeps its path from build to build, so it is revalidated.
const REVALIDATE: &str = "no-cache";

/// Studio's built files: a map from a path relative to the build (`index.html`, `assets/index-<hash>.js`) to its
/// bytes. Built from embedded bytes or from literals; nothing here reads a directory.
pub struct StudioFiles {
    files: BTreeMap<&'static str, &'static [u8]>,
}

impl StudioFiles {
    /// Refuses a set without `index.html` and a path that is not `/`-separated, without a leading `/`, and free of
    /// empty, `.` and `..` components.
    pub fn new(
        entries: impl IntoIterator<Item = (&'static str, &'static [u8])>,
    ) -> Result<StudioFiles, Error> {
        let mut files = BTreeMap::new();
        for (path, bytes) in entries {
            if !is_build_path(path) {
                return Err(Error::StudioPathInvalid {
                    path: path.to_owned(),
                });
            }
            files.insert(path, bytes);
        }
        if !files.contains_key(INDEX) {
            return Err(Error::StudioIndexMissing);
        }
        Ok(StudioFiles { files })
    }

    fn get(&self, path: &str) -> Option<(&'static str, &'static [u8])> {
        self.files
            .get_key_value(path)
            .map(|(key, bytes)| (*key, *bytes))
    }

    fn index(&self) -> &'static [u8] {
        self.files.get(INDEX).copied().unwrap_or_default()
    }
}

impl fmt::Debug for StudioFiles {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StudioFiles")
            .field("files", &self.files.len())
            .finish()
    }
}

fn is_build_path(path: &str) -> bool {
    path.split('/')
        .all(|component| !component.is_empty() && component != "." && component != "..")
}

/// What Studio's server needs: its own port (the `Host` it answers), the engine's port (`/config.json`), the
/// build, and its in-flight bound.
pub struct StudioState {
    pub studio_port: NonZeroU16,
    pub engine_port: NonZeroU16,
    pub files: Arc<StudioFiles>,
    pub max_in_flight: usize,
}

struct Studio {
    host: String,
    misdirected: String,
    config: Bytes,
    files: Arc<StudioFiles>,
    in_flight: InFlight,
}

/// Studio's service: one handler for every method and path, in the order of design section 3.
pub fn studio_app(state: StudioState) -> Router {
    let host = format!("127.0.0.1:{}", state.studio_port);
    let studio = Studio {
        misdirected: format!("Open Studio at http://{host}/."),
        host,
        config: Bytes::from(format!("{{\"enginePort\":{}}}", state.engine_port)),
        files: state.files,
        in_flight: InFlight::new(state.max_in_flight),
    };
    Router::new().fallback(handle).with_state(Arc::new(studio))
}

/// The request's body is never read: every answer is made from the method, the `Host` and the path.
async fn handle(State(studio): State<Arc<Studio>>, request: Request) -> Response {
    let method = request.method();
    let head = method == Method::HEAD;
    let Some(permit) = studio.in_flight.try_acquire() else {
        return text(
            StatusCode::SERVICE_UNAVAILABLE,
            "Studio is busy; try again.",
            head,
            &[],
        );
    };
    let response = if method != Method::GET && !head {
        text(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed.",
            false,
            &[(ALLOW, "GET, HEAD")],
        )
    } else if !has_only_host(request.headers(), &studio.host) {
        text(
            StatusCode::MISDIRECTED_REQUEST,
            &studio.misdirected,
            head,
            &[],
        )
    } else {
        file(&studio, request.uri().path(), head)
    };
    hold(response, permit)
}

/// Orders 4 to 7: `/config.json`, a file of the build, a missing asset, the page.
fn file(studio: &Studio, raw: &str, head: bool) -> Response {
    if raw == CONFIG_PATH {
        return answer(
            StatusCode::OK,
            &[
                (CONTENT_TYPE, "application/json"),
                (CACHE_CONTROL, "no-store"),
            ],
            studio.config.clone(),
            head,
        );
    }
    let found = percent_decode(raw).and_then(|decoded| {
        decoded
            .strip_prefix('/')
            .and_then(|key| studio.files.get(key))
    });
    if let Some((key, bytes)) = found {
        let cache = if key.starts_with(&ASSETS_PREFIX[1..]) {
            IMMUTABLE
        } else {
            REVALIDATE
        };
        return answer(
            StatusCode::OK,
            &[(CONTENT_TYPE, content_type(key)), (CACHE_CONTROL, cache)],
            Bytes::from_static(bytes),
            head,
        );
    }
    if raw.starts_with(ASSETS_PREFIX) {
        return text(StatusCode::NOT_FOUND, "Not found.", head, &[]);
    }
    // Every other path is a page of the app; the router in the page decides what it shows.
    answer(
        StatusCode::OK,
        &[
            (CONTENT_TYPE, content_type(INDEX)),
            (CACHE_CONTROL, REVALIDATE),
        ],
        Bytes::from_static(studio.files.index()),
        head,
    )
}

/// Exactly one `Host` header, equal to `expected`.
fn has_only_host(headers: &HeaderMap, expected: &str) -> bool {
    let mut hosts = headers.get_all(HOST).iter();
    match (hosts.next(), hosts.next()) {
        (Some(host), None) => host.as_bytes() == expected.as_bytes(),
        _ => false,
    }
}

/// `%XX` to a byte, then UTF-8; `None` for a malformed escape or a result that is not UTF-8.
fn percent_decode(path: &str) -> Option<String> {
    let mut bytes = path.bytes();
    let mut decoded = Vec::with_capacity(path.len());
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = hex(bytes.next()?)?;
            let low = hex(bytes.next()?)?;
            decoded.push(high << 4 | low);
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex(digit: u8) -> Option<u8> {
    char::from(digit)
        .to_digit(16)
        .and_then(|value| u8::try_from(value).ok())
}

/// The type of `key` by its extension, as `path.extname` finds it: from the last `.` of the last component,
/// unless that `.` begins the component.
fn content_type(key: &str) -> &'static str {
    let name = key.rsplit('/').next().unwrap_or(key);
    let extension = match name.rfind('.') {
        Some(dot) if dot > 0 => &name[dot..],
        _ => return OCTET_STREAM,
    };
    STUDIO_CONTENT_TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map_or(OCTET_STREAM, |(_, kind)| kind)
}

/// A text answer with a final newline, as `serve.ts` sends one.
fn text(
    status: StatusCode,
    message: &str,
    head: bool,
    extra: &[(HeaderName, &'static str)],
) -> Response {
    let mut headers = vec![(CONTENT_TYPE, TEXT)];
    headers.extend_from_slice(extra);
    answer(status, &headers, Bytes::from(format!("{message}\n")), head)
}

/// Every answer: `nosniff`, `no-referrer` and the body's `Content-Length`; a `HEAD` answer without its body.
fn answer(
    status: StatusCode,
    headers: &[(HeaderName, &'static str)],
    body: Bytes,
    head: bool,
) -> Response {
    let length = body.len();
    let mut response = Response::new(if head {
        Body::empty()
    } else {
        Body::from(body)
    });
    *response.status_mut() = status;
    let map = response.headers_mut();
    map.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    map.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    map.insert(CONTENT_LENGTH, HeaderValue::from(length));
    for (name, value) in headers {
        map.insert(name.clone(), HeaderValue::from_static(value));
    }
    response
}
