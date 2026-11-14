//! Pure SigV4 (`AWS4-HMAC-SHA256`): which form of authentication a client request carries, its canonical
//! request, the string to sign and the signature. No I/O, no clock: every date comes from the request.
//!
//! Canonicalization follows the AWS General Reference, "Create a signed AWS API request". The engine never
//! verifies a client's signature; [`classify`] only reads its form.

use http::header::{AUTHORIZATION, HeaderMap, HeaderName};
use http::request::Parts;
use http::{HeaderValue, Method};
use ring::{digest, hmac};

use crate::Secret;

/// The only algorithm the engine reads or writes.
pub const ALGORITHM: &str = "AWS4-HMAC-SHA256";
/// The payload hash the engine adds and signs when a header-signed client sent none, and the payload hash of
/// every query-signed request.
pub const UNSIGNED_PAYLOAD: &str = "UNSIGNED-PAYLOAD";
/// The `x-amz-content-sha256` values whose body carries a chain of chunk signatures. Compared exactly.
pub const SIGNED_CHUNK_MODES: [&str; 4] = [
    "STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
    "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER",
    "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD",
    "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER",
];
/// The last element of every credential scope.
const TERMINATOR: &str = "aws4_request";
const AMZ_DATE: &str = "x-amz-date";

/// The query parameters of a presigned URL, each required exactly once.
const QUERY_ALGORITHM: &str = "X-Amz-Algorithm";
const QUERY_CREDENTIAL: &str = "X-Amz-Credential";
const QUERY_DATE: &str = "X-Amz-Date";
const QUERY_EXPIRES: &str = "X-Amz-Expires";
const QUERY_SIGNED_HEADERS: &str = "X-Amz-SignedHeaders";
const QUERY_SIGNATURE: &str = "X-Amz-Signature";

/// The credential scope as the client sent it: `yyyymmdd`, region and service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scope {
    pub date: String,
    pub region: String,
    pub service: String,
}

/// What a well-formed SigV4 request says about itself. The access key id is the client's own, not a secret, but
/// it is caller data and is never logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientAuth {
    pub access_key_id: String,
    pub scope: Scope,
    /// `X-Amz-Date`, `yyyymmddThhmmssZ`.
    pub amz_date: String,
    /// The client's signed header names, in the order it listed them.
    pub signed_headers: Vec<HeaderName>,
    /// `X-Amz-Expires`, for the query form only.
    pub expires: Option<String>,
}

/// The form of authentication a request carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Auth {
    /// A well-formed SigV4 `Authorization` header.
    Header(ClientAuth),
    /// A well-formed presigned URL.
    Query(ClientAuth),
    /// Anything else: no signature, another scheme, a malformed or incomplete SigV4 signature, or both forms.
    Other,
}

/// How the canonical URI is built from the raw path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UriMode {
    /// The path as sent (service `s3`).
    AsSent,
    /// Each segment of the raw path URI-encoded again (every other service).
    EncodeSegments,
}

/// Reads the form of authentication of a request head. Header form needs every element of a well-formed
/// `Authorization` header and an `X-Amz-Date` header; query form needs the six `X-Amz-*` parameters, each
/// exactly once, and no `Authorization` header. Any deviation is [`Auth::Other`].
pub fn classify(parts: &Parts) -> Auth {
    let query = query_pairs(parts.uri.query().unwrap_or(""));
    let has_query_signature = query
        .iter()
        .any(|(name, _)| name == QUERY_SIGNATURE.as_bytes());
    let mut authorization = parts.headers.get_all(AUTHORIZATION).iter();
    match (authorization.next(), authorization.next()) {
        (Some(value), None) if !has_query_signature => {
            header_auth(value, &parts.headers).map_or(Auth::Other, Auth::Header)
        }
        (None, _) => query_auth(&query).map_or(Auth::Other, Auth::Query),
        _ => Auth::Other,
    }
}

fn header_auth(authorization: &HeaderValue, headers: &HeaderMap) -> Option<ClientAuth> {
    let value = authorization.to_str().ok()?;
    let rest = value.strip_prefix(ALGORITHM)?.strip_prefix(' ')?;
    let (mut credential, mut signed, mut signature) = (None, None, None);
    for component in rest.split(',') {
        let (name, value) = component.trim().split_once('=')?;
        let slot = match name {
            "Credential" => &mut credential,
            "SignedHeaders" => &mut signed,
            "Signature" => &mut signature,
            _ => return None,
        };
        if slot.replace(value).is_some() {
            return None;
        }
    }
    if !is_signature(signature?) {
        return None;
    }
    let (access_key_id, scope) = credential_parts(credential?)?;
    let signed_headers = signed_header_names(signed?)?;
    let mut dates = headers.get_all(AMZ_DATE).iter();
    let amz_date = match (dates.next(), dates.next()) {
        (Some(date), None) => date.to_str().ok()?,
        _ => return None,
    };
    if !is_amz_date(amz_date, &scope.date) {
        return None;
    }
    Some(ClientAuth {
        access_key_id,
        scope,
        amz_date: amz_date.to_owned(),
        signed_headers,
        expires: None,
    })
}

fn query_auth(pairs: &[(Vec<u8>, Vec<u8>)]) -> Option<ClientAuth> {
    let only = |name: &str| -> Option<String> {
        let mut values = pairs
            .iter()
            .filter(|(key, _)| key == name.as_bytes())
            .map(|(_, value)| value);
        match (values.next(), values.next()) {
            (Some(value), None) => String::from_utf8(value.clone()).ok(),
            _ => None,
        }
    };
    if only(QUERY_ALGORITHM)? != ALGORITHM {
        return None;
    }
    only(QUERY_SIGNATURE)?;
    let (access_key_id, scope) = credential_parts(&only(QUERY_CREDENTIAL)?)?;
    let amz_date = only(QUERY_DATE)?;
    if !is_amz_date(&amz_date, &scope.date) {
        return None;
    }
    let expires = only(QUERY_EXPIRES)?;
    let signed_headers = signed_header_names(&only(QUERY_SIGNED_HEADERS)?)?;
    Some(ClientAuth {
        access_key_id,
        scope,
        amz_date,
        signed_headers,
        expires: Some(expires),
    })
}

/// `<akid>/<yyyymmdd>/<region>/<service>/aws4_request`, every part non-empty.
fn credential_parts(credential: &str) -> Option<(String, Scope)> {
    let parts: Vec<&str> = credential.split('/').collect();
    let [access_key_id, date, region, service, terminator] = parts.as_slice() else {
        return None;
    };
    let well_formed = !access_key_id.is_empty()
        && is_digits(date, 8)
        && !region.is_empty()
        && !service.is_empty()
        && *terminator == TERMINATOR;
    well_formed.then(|| {
        (
            (*access_key_id).to_owned(),
            Scope {
                date: (*date).to_owned(),
                region: (*region).to_owned(),
                service: (*service).to_owned(),
            },
        )
    })
}

/// A `;`-separated list of header names that contains `host`.
fn signed_header_names(list: &str) -> Option<Vec<HeaderName>> {
    let names = list
        .split(';')
        .map(|name| HeaderName::from_bytes(name.as_bytes()).ok())
        .collect::<Option<Vec<_>>>()?;
    names.contains(&http::header::HOST).then_some(names)
}

fn is_signature(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// `yyyymmddThhmmssZ` whose date is `scope_date`.
fn is_amz_date(value: &str, scope_date: &str) -> bool {
    let bytes = value.as_bytes();
    let digits = |range: std::ops::Range<usize>| bytes[range].iter().all(u8::is_ascii_digit);
    bytes.len() == 16
        && digits(0..8)
        && bytes[8] == b'T'
        && digits(9..15)
        && bytes[15] == b'Z'
        && &bytes[..8] == scope_date.as_bytes()
}

fn is_digits(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// The canonical request: method, canonical URI, canonical query, canonical headers of `signed`, the signed
/// header list and the payload hash, joined by newlines. `signed` is sorted and deduplicated here. A header value
/// that is not UTF-8 is read lossily; such a request cannot be signed as sent and the emulator refuses it.
pub fn canonical_request(
    method: &Method,
    raw_path: &str,
    raw_query: &str,
    headers: &HeaderMap,
    signed: &[HeaderName],
    payload_hash: &str,
    mode: UriMode,
) -> String {
    let mut names: Vec<&str> = signed.iter().map(HeaderName::as_str).collect();
    names.sort_unstable();
    names.dedup();
    let mut canonical = format!(
        "{}\n{}\n{}\n",
        method.as_str(),
        canonical_uri(raw_path, mode),
        canonical_query(raw_query)
    );
    for name in &names {
        let values: Vec<String> = headers
            .get_all(*name)
            .iter()
            .map(|value| canonical_header_value(&String::from_utf8_lossy(value.as_bytes())))
            .collect();
        canonical.push_str(name);
        canonical.push(':');
        canonical.push_str(&values.join(","));
        canonical.push('\n');
    }
    canonical.push('\n');
    canonical.push_str(&names.join(";"));
    canonical.push('\n');
    canonical.push_str(payload_hash);
    canonical
}

/// `AWS4-HMAC-SHA256`, the request date, the credential scope and the hex SHA-256 of the canonical request.
pub fn string_to_sign(amz_date: &str, scope: &Scope, canonical_request: &str) -> String {
    let hash = digest::digest(&digest::SHA256, canonical_request.as_bytes());
    format!(
        "{ALGORITHM}\n{amz_date}\n{}\n{}",
        scope_text(scope),
        hex(hash.as_ref())
    )
}

/// The lower-case hex HMAC-SHA256 of `string_to_sign` under the signing key derived from `secret` and `scope`.
pub fn signature(secret: &Secret, scope: &Scope, string_to_sign: &str) -> String {
    let derive = |key: &[u8], data: &str| {
        hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), data.as_bytes())
    };
    let date_key = derive(format!("AWS4{}", secret.expose()).as_bytes(), &scope.date);
    let region_key = derive(date_key.as_ref(), &scope.region);
    let service_key = derive(region_key.as_ref(), &scope.service);
    let signing_key = derive(service_key.as_ref(), TERMINATOR);
    hex(derive(signing_key.as_ref(), string_to_sign).as_ref())
}

/// `<yyyymmdd>/<region>/<service>/aws4_request`.
pub fn scope_text(scope: &Scope) -> String {
    format!(
        "{}/{}/{}/{TERMINATOR}",
        scope.date, scope.region, scope.service
    )
}

fn canonical_uri(raw_path: &str, mode: UriMode) -> String {
    let path = if raw_path.is_empty() { "/" } else { raw_path };
    match mode {
        UriMode::AsSent => path.to_owned(),
        UriMode::EncodeSegments => path
            .split('/')
            .map(|segment| uri_encode(segment.as_bytes()))
            .collect::<Vec<_>>()
            .join("/"),
    }
}

/// Each name and value percent-decoded, then encoded with the unreserved set; a parameter without `=` has an
/// empty value; sorted by name, then value.
fn canonical_query(raw_query: &str) -> String {
    let mut pairs: Vec<(String, String)> = query_pairs(raw_query)
        .iter()
        .map(|(name, value)| (uri_encode(name), uri_encode(value)))
        .collect();
    pairs.sort_unstable();
    pairs
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// The query's parameters in order, names and values percent-decoded (`+` stays `+`); empty segments skipped.
fn query_pairs(raw_query: &str) -> Vec<(Vec<u8>, Vec<u8>)> {
    raw_query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(name), percent_decode(value))
        })
        .collect()
}

/// Trimmed, inner runs of spaces collapsed to one.
fn canonical_header_value(value: &str) -> String {
    value
        .trim()
        .split(' ')
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Every byte outside `A-Z a-z 0-9 - . _ ~` as `%XX`, upper-case hex.
fn uri_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(bytes.len());
    for &byte in bytes {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX[usize::from(byte >> 4)]));
            out.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    out
}

/// `%XX` decoded; a `%` not followed by two hex digits is kept as it is.
fn percent_decode(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let escaped = |index: usize| -> Option<u8> {
        let high = hex_value(*bytes.get(index + 1)?)?;
        let low = hex_value(*bytes.get(index + 2)?)?;
        Some(high << 4 | low)
    };
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && let Some(byte) = escaped(index)
        {
            out.push(byte);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    out
}

fn hex_value(digit: u8) -> Option<u8> {
    char::from(digit)
        .to_digit(16)
        .and_then(|value| u8::try_from(value).ok())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
