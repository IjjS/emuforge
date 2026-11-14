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

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNATURE: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    const MESSAGE: &str = r#"a < b & "c""#;

    fn head(method: Method, uri: &str, headers: &[(&str, &str)]) -> Parts {
        let mut builder = axum::http::Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        builder.body(()).unwrap().into_parts().0
    }

    fn authorization(service: &str) -> String {
        format!(
            "AWS4-HMAC-SHA256 Credential=AKIACLIENTKEY0000001/20261115/us-east-1/{service}/aws4_request, SignedHeaders=host;x-amz-date, Signature={SIGNATURE}"
        )
    }

    fn header_signed(method: Method, uri: &str, service: &str, extra: &[(&str, &str)]) -> Parts {
        let auth = authorization(service);
        let mut headers = vec![
            ("authorization", auth.as_str()),
            ("x-amz-date", "20261115T000000Z"),
        ];
        headers.extend_from_slice(extra);
        head(method, uri, &headers)
    }

    fn body_text(response: Response) -> (StatusCode, axum::http::HeaderMap, String) {
        let (parts, body) = response.into_parts();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let bytes = runtime
            .block_on(axum::body::to_bytes(body, usize::MAX))
            .unwrap();
        (
            parts.status,
            parts.headers,
            String::from_utf8(bytes.to_vec()).unwrap(),
        )
    }

    #[test]
    fn detect_with_target_is_json_with_the_request_version() {
        let cases = [
            ("1.1", Some(JSON_1_1), JSON_1_1),
            ("1.0", Some(JSON_1_0), JSON_1_0),
            ("no content type", None, JSON_1_0),
        ];
        for (name, content_type, expected) in cases {
            let mut headers = vec![("x-amz-target", "DynamoDB_20120810.ListTables")];
            if let Some(content_type) = content_type {
                headers.push(("content-type", content_type));
            }
            assert_eq!(
                Protocol::detect(&head(Method::POST, "/", &headers)),
                Protocol::Json {
                    content_type: expected
                },
                "case {name}"
            );
        }
    }

    #[test]
    fn detect_with_s3_credential_is_rest_xml() {
        let query = format!(
            "/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIACLIENTKEY0000001%2F20261115%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261115T000000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=host&X-Amz-Signature={SIGNATURE}"
        );
        let cases = [
            (
                "header-signed form POST",
                header_signed(
                    Method::POST,
                    "/b?delete",
                    "s3",
                    &[("content-type", "application/x-www-form-urlencoded")],
                ),
            ),
            ("query-signed", head(Method::GET, &query, &[])),
        ];
        for (name, parts) in cases {
            assert_eq!(Protocol::detect(&parts), Protocol::RestXml, "case {name}");
        }
    }

    #[test]
    fn detect_with_form_post_or_action_is_query() {
        let cases = [
            (
                "form POST for iam",
                header_signed(
                    Method::POST,
                    "/",
                    "iam",
                    &[(
                        "content-type",
                        "application/x-www-form-urlencoded; charset=utf-8",
                    )],
                ),
            ),
            (
                "GET with Action",
                head(Method::GET, "/?Action=ListUsers&Version=2010-05-08", &[]),
            ),
        ];
        for (name, parts) in cases {
            assert_eq!(Protocol::detect(&parts), Protocol::Query, "case {name}");
        }
    }

    #[test]
    fn detect_otherwise_is_rest_json() {
        let cases = [
            (
                "header-signed GET for lambda",
                header_signed(Method::GET, "/2015-03-31/functions/", "lambda", &[]),
            ),
            ("unsigned GET /", head(Method::GET, "/", &[])),
        ];
        for (name, parts) in cases {
            assert_eq!(Protocol::detect(&parts), Protocol::RestJson, "case {name}");
        }
    }

    fn rendered(
        protocol: Protocol,
        kind: ErrorType,
    ) -> (StatusCode, axum::http::HeaderMap, String) {
        body_text(render(
            protocol,
            StatusCode::SERVICE_UNAVAILABLE,
            "EmulatorUnavailable",
            kind,
            MESSAGE,
            false,
        ))
    }

    #[test]
    fn render_json_has_the_given_content_type_error_type_and_json_body() {
        for content_type in [JSON_1_0, JSON_1_1] {
            let (status, headers, body) =
                rendered(Protocol::Json { content_type }, ErrorType::Receiver);
            assert_eq!(
                status,
                StatusCode::SERVICE_UNAVAILABLE,
                "case {content_type}"
            );
            assert_eq!(headers[CONTENT_TYPE], content_type, "case {content_type}");
            assert_eq!(
                headers["x-amzn-errortype"], "EmulatorUnavailable",
                "case {content_type}"
            );
            let json: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(
                json,
                serde_json::json!({"__type": "EmulatorUnavailable", "message": MESSAGE}),
                "case {content_type}"
            );
        }
    }

    #[test]
    fn render_rest_xml_is_an_escaped_s3_error() {
        let (_, headers, body) = rendered(Protocol::RestXml, ErrorType::Receiver);
        assert_eq!(headers[CONTENT_TYPE], "application/xml");
        assert!(!headers.contains_key("x-amzn-errortype"));
        assert_eq!(
            body,
            "<Error><Code>EmulatorUnavailable</Code><Message>a &lt; b &amp; &quot;c&quot;</Message></Error>"
        );
    }

    #[test]
    fn render_query_is_an_escaped_error_response_with_its_type() {
        for (kind, name) in [
            (ErrorType::Receiver, "Receiver"),
            (ErrorType::Sender, "Sender"),
        ] {
            let (_, headers, body) = rendered(Protocol::Query, kind);
            assert_eq!(headers[CONTENT_TYPE], "text/xml", "case {name}");
            assert_eq!(
                body,
                format!(
                    "<?xml version=\"1.0\"?><ErrorResponse><Error><Type>{name}</Type><Code>EmulatorUnavailable</Code><Message>a &lt; b &amp; &quot;c&quot;</Message></Error></ErrorResponse>"
                ),
                "case {name}"
            );
        }
    }

    #[test]
    fn render_rest_json_has_application_json_error_type_and_json_body() {
        let (_, headers, body) = rendered(Protocol::RestJson, ErrorType::Receiver);
        assert_eq!(headers[CONTENT_TYPE], "application/json");
        assert_eq!(headers["x-amzn-errortype"], "EmulatorUnavailable");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"__type": "EmulatorUnavailable", "message": MESSAGE})
        );
    }

    #[test]
    fn render_head_only_has_the_same_status_and_headers_and_no_body() {
        let protocols = [
            Protocol::Json {
                content_type: JSON_1_1,
            },
            Protocol::RestXml,
            Protocol::Query,
            Protocol::RestJson,
        ];
        for protocol in protocols {
            let full = rendered(protocol, ErrorType::Receiver);
            let head = body_text(render(
                protocol,
                StatusCode::SERVICE_UNAVAILABLE,
                "EmulatorUnavailable",
                ErrorType::Receiver,
                MESSAGE,
                true,
            ));
            assert_eq!(head.0, full.0, "case {protocol:?}");
            assert_eq!(head.1, full.1, "case {protocol:?}");
            assert!(head.2.is_empty(), "case {protocol:?}");
        }
    }
}
