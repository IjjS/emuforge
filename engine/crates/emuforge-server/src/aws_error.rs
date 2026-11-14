//! The engine's own errors on a relayed path, in the protocol the caller used (requirement §6, D7): the shapes
//! the emulator itself answers with. Only the request head is read, never its body.

use axum::body::Body;
use axum::http::header::CONTENT_TYPE;
use axum::http::request::Parts;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::response::Response;
use emuforge_core::sigv4::{Auth, classify};

const X_AMZ_TARGET: &str = "x-amz-target";
const X_AMZN_ERROR_TYPE: HeaderName = HeaderName::from_static("x-amzn-errortype");
const JSON_1_0: &str = "application/x-amz-json-1.0";
const JSON_1_1: &str = "application/x-amz-json-1.1";
const FORM: &str = "application/x-www-form-urlencoded";

/// The AWS wire protocol of a request, as far as its head tells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// `X-Amz-Target`: the request's JSON content type when it is 1.0 or 1.1, else 1.0.
    Json { content_type: &'static str },
    /// Signed for service `s3`.
    RestXml,
    /// A form `POST` or `Action=` in the query.
    Query,
    /// Anything else.
    RestJson,
}

/// Who is at fault, for the query protocol's `Type`: the caller for a 4xx, the engine or the emulator for a 5xx.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorType {
    Sender,
    Receiver,
}

impl ErrorType {
    /// `Receiver` for a 5xx status, `Sender` for every other.
    pub fn for_status(status: StatusCode) -> ErrorType {
        if status.is_server_error() {
            ErrorType::Receiver
        } else {
            ErrorType::Sender
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            ErrorType::Sender => "Sender",
            ErrorType::Receiver => "Receiver",
        }
    }
}

impl Protocol {
    /// Tried in order: `X-Amz-Target` → JSON; credential service `s3` (header or query form) → REST-XML; a
    /// `POST` with a form `Content-Type` or `Action=` in the query → Query; else REST-JSON.
    pub fn detect(parts: &Parts) -> Protocol {
        if parts.headers.contains_key(X_AMZ_TARGET) {
            let content_type = match parts.headers.get(CONTENT_TYPE).map(HeaderValue::as_bytes) {
                Some(value) if value == JSON_1_1.as_bytes() => JSON_1_1,
                _ => JSON_1_0,
            };
            return Protocol::Json { content_type };
        }
        if let Auth::Header(client) | Auth::Query(client) = classify(parts)
            && client.scope.service == "s3"
        {
            return Protocol::RestXml;
        }
        if (parts.method == Method::POST && is_form(parts)) || has_action(parts) {
            return Protocol::Query;
        }
        Protocol::RestJson
    }
}

/// `application/x-www-form-urlencoded`, with or without parameters such as `; charset=utf-8`.
fn is_form(parts: &Parts) -> bool {
    parts
        .headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case(FORM))
}

/// A query parameter named exactly `Action`.
fn has_action(parts: &Parts) -> bool {
    parts.uri.query().is_some_and(|query| {
        query
            .split('&')
            .any(|pair| pair.split('=').next() == Some("Action"))
    })
}

/// An error answer in `protocol`'s shape. `message` is the engine's own text; it is escaped or JSON-encoded,
/// never interpreted. With `head_only` the status and headers are those of the full answer and the body is
/// empty.
pub fn render(
    protocol: Protocol,
    status: StatusCode,
    code: &str,
    kind: ErrorType,
    message: &str,
    head_only: bool,
) -> Response {
    let (content_type, error_type, body) = match protocol {
        Protocol::Json { content_type } => (content_type, true, json_body(code, message)),
        Protocol::RestJson => ("application/json", true, json_body(code, message)),
        Protocol::RestXml => (
            "application/xml",
            false,
            format!(
                "<Error><Code>{}</Code><Message>{}</Message></Error>",
                xml_escape(code),
                xml_escape(message)
            ),
        ),
        Protocol::Query => (
            "text/xml",
            false,
            format!(
                "<?xml version=\"1.0\"?><ErrorResponse><Error><Type>{}</Type><Code>{}</Code><Message>{}</Message></Error></ErrorResponse>",
                kind.as_str(),
                xml_escape(code),
                xml_escape(message)
            ),
        ),
    };
    let body = if head_only {
        Body::empty()
    } else {
        Body::from(body)
    };
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    if error_type && let Ok(value) = HeaderValue::from_str(code) {
        headers.insert(X_AMZN_ERROR_TYPE, value);
    }
    response
}

#[derive(serde::Serialize)]
struct JsonError<'a> {
    #[serde(rename = "__type")]
    code: &'a str,
    message: &'a str,
}

fn json_body(code: &str, message: &str) -> String {
    // Two strings always serialize; were it to fail, the answer would only lose its body.
    serde_json::to_string(&JsonError { code, message }).unwrap_or_default()
}

fn xml_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '&' => escaped.push_str("&amp;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            c => escaped.push(c),
        }
    }
    escaped
}
