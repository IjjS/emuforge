#![cfg(test)]

//! Studio's server (issue 484, design section 3): `StudioFiles` and `studio_app` over a build given as literals.

use std::num::NonZeroU16;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ALLOW, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, HOST, ORIGIN, REFERRER_POLICY,
    X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use emuforge_server::{Error, STUDIO_CONTENT_TYPES, StudioFiles, StudioState, studio_app};
use hyper::body::{Bytes, Frame};
use tower::ServiceExt;

const STUDIO_PORT: u16 = 8296;
const ENGINE_PORT: u16 = 8297;
const STUDIO_HOST: &str = "127.0.0.1:8296";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// Each file's bytes are its own path, so an answer says which file it is.
const BUILD: &[&str] = &[
    "index.html",
    "assets/app-1.js",
    "assets/app-1.css",
    "f.html",
    "f.js",
    "f.css",
    "f.json",
    "f.map",
    "f.svg",
    "f.png",
    "f.ico",
    "f.woff",
    "f.woff2",
    "f.txt",
    "data.bin",
    "LICENSE",
];

fn files(paths: &[&'static str]) -> Result<StudioFiles, Error> {
    StudioFiles::new(paths.iter().map(|path| (*path, path.as_bytes())))
}

fn studio(max_in_flight: usize) -> Router {
    studio_app(StudioState {
        studio_port: NonZeroU16::new(STUDIO_PORT).unwrap(),
        engine_port: NonZeroU16::new(ENGINE_PORT).unwrap(),
        files: Arc::new(files(BUILD).unwrap()),
        max_in_flight,
    })
}

fn request(method: Method, path: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header(HOST, STUDIO_HOST)
}

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl Answer {
    fn header(&self, name: impl axum::http::header::AsHeaderName) -> &str {
        self.headers
            .get(name)
            .map(|value| value.to_str().unwrap())
            .unwrap_or("")
    }
}

/// Sends `request` and checks what every answer carries: `nosniff`, `no-referrer`, no CORS header, and, unless
/// it answers `HEAD`, a `Content-Length` equal to the body's length.
async fn send(app: &Router, request: Request<Body>) -> Answer {
    let head = request.method() == Method::HEAD;
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    let answer = Answer {
        status: parts.status,
        headers: parts.headers,
        body,
    };
    assert_eq!(answer.header(X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(answer.header(REFERRER_POLICY), "no-referrer");
    for name in answer.headers.keys() {
        assert!(
            !name.as_str().starts_with("access-control-"),
            "CORS header {name}"
        );
    }
    if !head {
        assert_eq!(
            answer.header(CONTENT_LENGTH),
            answer.body.len().to_string(),
            "Content-Length"
        );
    }
    answer
}

async fn get(app: &Router, path: &str) -> Answer {
    send(app, request(Method::GET, path).body(Body::empty()).unwrap()).await
}

#[test]
fn studio_files_with_index_and_an_asset_is_ok() {
    assert!(files(&["index.html", "assets/a.js"]).is_ok());
}

#[test]
fn studio_files_without_index_is_index_missing() {
    let error = files(&["assets/a.js"]).unwrap_err();
    assert!(matches!(error, Error::StudioIndexMissing), "{error:?}");
}

#[test]
fn studio_files_invalid_path_is_path_invalid_naming_it() {
    for path in ["/index.html", "assets/../x", "./x", "assets//x", "assets/"] {
        let error = StudioFiles::new([("index.html", &b"i"[..]), (path, &b"x"[..])]).unwrap_err();
        assert!(
            matches!(&error, Error::StudioPathInvalid { path: named } if named == path),
            "case {path}: {error:?}"
        );
        assert!(error.to_string().contains(path), "case {path}: {error}");
    }
}

#[tokio::test]
async fn studio_get_root_is_index_html_revalidated() {
    let answer = get(&studio(32), "/").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(&answer.body[..], b"index.html");
    assert_eq!(answer.header(CONTENT_TYPE), "text/html; charset=utf-8");
    assert_eq!(answer.header(CACHE_CONTROL), "no-cache");
}

#[tokio::test]
async fn studio_get_page_path_is_index_html() {
    let app = studio(32);
    for path in [
        "/aws/dynamodb/tables",
        "/does-not-exist",
        "/%ZZ",
        "/..%2f..%2fetc%2fpasswd",
        "/assets",
    ] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::OK, "case {path}");
        assert_eq!(&answer.body[..], b"index.html", "case {path}");
        assert_eq!(answer.header(CACHE_CONTROL), "no-cache", "case {path}");
    }
}

#[tokio::test]
async fn studio_get_asset_is_its_bytes_typed_and_immutable() {
    let app = studio(32);
    for (path, kind) in [
        ("/assets/app-1.js", "text/javascript; charset=utf-8"),
        ("/assets/app-1.css", "text/css; charset=utf-8"),
    ] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::OK, "case {path}");
        assert_eq!(&answer.body[..], &path.as_bytes()[1..], "case {path}");
        assert_eq!(answer.header(CONTENT_TYPE), kind, "case {path}");
        assert_eq!(answer.header(CACHE_CONTROL), IMMUTABLE, "case {path}");
    }
}

#[tokio::test]
async fn studio_get_each_extension_outside_assets_is_typed_and_revalidated() {
    // `serve.ts` lines 19-31, written out here rather than read from the table under test.
    let expected = [
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
    assert_eq!(STUDIO_CONTENT_TYPES, &expected[..]);
    let app = studio(32);
    for (extension, kind) in expected {
        let path = format!("/f{extension}");
        let answer = get(&app, &path).await;
        assert_eq!(answer.status, StatusCode::OK, "case {extension}");
        assert_eq!(&answer.body[..], &path.as_bytes()[1..], "case {extension}");
        assert_eq!(answer.header(CONTENT_TYPE), kind, "case {extension}");
        assert_eq!(answer.header(CACHE_CONTROL), "no-cache", "case {extension}");
    }
}

#[tokio::test]
async fn studio_get_unknown_or_no_extension_is_octet_stream() {
    let app = studio(32);
    for path in ["/data.bin", "/LICENSE"] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::OK, "case {path}");
        assert_eq!(&answer.body[..], &path.as_bytes()[1..], "case {path}");
        assert_eq!(
            answer.header(CONTENT_TYPE),
            "application/octet-stream",
            "case {path}"
        );
    }
}

#[tokio::test]
async fn studio_get_percent_encoded_asset_path_is_that_asset() {
    let answer = get(&studio(32), "/assets/app-1%2Ejs").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(&answer.body[..], b"assets/app-1.js");
}

#[tokio::test]
async fn studio_get_missing_asset_is_404_not_found() {
    let app = studio(32);
    for path in ["/assets/missing.js", "/assets/../index.html"] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::NOT_FOUND, "case {path}");
        assert_eq!(
            answer.header(CONTENT_TYPE),
            "text/plain; charset=utf-8",
            "case {path}"
        );
        assert_eq!(&answer.body[..], b"Not found.\n", "case {path}");
    }
}

#[tokio::test]
async fn studio_get_config_json_is_the_engine_port_uncached() {
    let app = studio(32);
    for path in ["/config.json", "/config.json?x=1"] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::OK, "case {path}");
        assert_eq!(
            answer.header(CONTENT_TYPE),
            "application/json",
            "case {path}"
        );
        assert_eq!(answer.header(CACHE_CONTROL), "no-store", "case {path}");
        assert_eq!(&answer.body[..], b"{\"enginePort\":8297}", "case {path}");
    }
}

#[tokio::test]
async fn studio_head_is_the_gets_status_and_headers_without_a_body() {
    let app = studio(32);
    for path in ["/", "/config.json", "/assets/missing.js"] {
        let got = get(&app, path).await;
        let head = send(
            &app,
            request(Method::HEAD, path).body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(head.status, got.status, "case {path}");
        assert_eq!(head.headers, got.headers, "case {path}");
        assert!(head.body.is_empty(), "case {path}");
    }
}

#[tokio::test]
async fn studio_other_method_is_405_allowing_get_and_head() {
    let app = studio(32);
    for (method, path) in [
        (Method::POST, "/"),
        (Method::PUT, "/index.html"),
        (Method::DELETE, "/config.json"),
        (Method::OPTIONS, "/"),
    ] {
        let answer = send(
            &app,
            request(method.clone(), path).body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(
            answer.status,
            StatusCode::METHOD_NOT_ALLOWED,
            "case {method} {path}"
        );
        assert_eq!(answer.header(ALLOW), "GET, HEAD", "case {method} {path}");
        assert_eq!(
            &answer.body[..],
            b"Method not allowed.\n",
            "case {method} {path}"
        );
    }
}

/// A request body that never yields a frame, and records whether it was polled.
struct Endless(Arc<AtomicBool>);

impl hyper::body::Body for Endless {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        self.0.store(true, Ordering::SeqCst);
        Poll::Pending
    }
}

#[tokio::test]
async fn studio_post_with_endless_body_is_405_without_reading_it() {
    let polled = Arc::new(AtomicBool::new(false));
    let body = Body::new(Endless(polled.clone()));
    let answer = send(&studio(32), request(Method::POST, "/").body(body).unwrap()).await;
    assert_eq!(answer.status, StatusCode::METHOD_NOT_ALLOWED);
    assert!(!polled.load(Ordering::SeqCst), "the body was read");
}

#[tokio::test]
async fn studio_get_with_another_host_is_421_naming_studios_address() {
    let app = studio(32);
    let cases: [(&str, &[&str]); 5] = [
        ("localhost", &["localhost:8296"]),
        ("engine port", &["127.0.0.1:8297"]),
        ("0.0.0.0", &["0.0.0.0:8296"]),
        ("absent", &[]),
        ("two", &[STUDIO_HOST, STUDIO_HOST]),
    ];
    for (name, hosts) in cases {
        let mut builder = Request::builder().method(Method::GET).uri("/");
        for host in hosts {
            builder = builder.header(HOST, *host);
        }
        let answer = send(&app, builder.body(Body::empty()).unwrap()).await;
        assert_eq!(
            answer.status,
            StatusCode::MISDIRECTED_REQUEST,
            "case {name}"
        );
        assert_eq!(
            &answer.body[..],
            b"Open Studio at http://127.0.0.1:8296/.\n",
            "case {name}"
        );
    }
}

#[tokio::test]
async fn studio_get_with_a_foreign_origin_is_answered_as_without_it() {
    let app = studio(32);
    for path in ["/", "/config.json"] {
        let plain = get(&app, path).await;
        let foreign = send(
            &app,
            request(Method::GET, path)
                .header(ORIGIN, "http://evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(foreign.status, plain.status, "case {path}");
        assert_eq!(foreign.body, plain.body, "case {path}");
    }
}

#[tokio::test]
async fn studio_in_flight_bound_zero_is_503_busy_and_one_is_served() {
    let busy = get(&studio(0), "/").await;
    assert_eq!(busy.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(&busy.body[..], b"Studio is busy; try again.\n");
    let served = get(&studio(1), "/").await;
    assert_eq!(served.status, StatusCode::OK);
}
