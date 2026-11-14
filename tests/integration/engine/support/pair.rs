//! "Matches direct" (`test-criteria.md`, issue 2): the same request sent straight to the emulator,
//! header-signed with the emulator's key, and through the engine, signed with the check key, against the same
//! emulator state. The two answers match when the status, `Content-Type`, every `x-amz-*` and `x-amzn-*`
//! header except the request ids, and the body byte for byte after normalization are equal; `x-amz-crc32`,
//! when present, must equal the CRC32 of the body received on that side.
//!
//! Normalization replaces the text of every `<RequestId>` and `<HostId>` element and of the elements a check
//! names as generated (a name may start or end with `*`: `*Bytes`, `CanonicalRequest*`).

use crate::support::aws::{Call, Endpoint, Key};
use crate::support::check::{Ctx, Env};
use crate::support::http::Response;

/// Response headers that differ per request and are not compared.
const REQUEST_ID_HEADERS: [&str; 3] = ["x-amz-request-id", "x-amz-id-2", "x-amzn-requestid"];

/// Elements whose text every comparison replaces.
const ALWAYS_GENERATED: [&str; 2] = ["RequestId", "HostId"];

const PLACEHOLDER: &str = "[generated]";

/// The direct answer and the engine's answer to one request.
pub struct Pair {
    pub direct: Response,
    pub engine: Response,
}

/// Sends `call` directly (emulator key, emulator host) and then through the engine (check key, engine host).
/// `Env` when the emulator gives no answer; a failed assertion when the engine gives none.
pub fn pair(ctx: &Ctx, what: &str, call: &Call) -> Result<Pair, Env> {
    pair_with(ctx, what, call, &Key::check())
}

/// As `pair`, with `client_key` as the key of the request sent through the engine.
pub fn pair_with(ctx: &Ctx, what: &str, call: &Call, client_key: &Key) -> Result<Pair, Env> {
    let direct = call
        .send(
            ctx,
            &Endpoint::emulator(ctx),
            &Key::of_emulator(ctx, ctx.emulator_port)?,
        )
        .map_err(|e| Env::new(format!("{what}: the emulator gave no answer directly: {e}")))?;
    let engine = call
        .send(ctx, &Endpoint::engine(ctx), client_key)
        .unwrap_or_else(|e| panic!("{what}: the engine gave no answer: {e}"));
    Ok(Pair { direct, engine })
}

/// `pair`, then `assert_matches_direct`; returns the pair for further assertions.
pub fn matches_direct(ctx: &Ctx, what: &str, call: &Call, generated: &[&str]) -> Result<Pair, Env> {
    let p = pair(ctx, what, call)?;
    assert_matches_direct(ctx, what, &p, generated);
    Ok(p)
}

fn compared_headers(response: &Response) -> Vec<(String, String)> {
    let mut headers: Vec<(String, String)> = response
        .headers
        .iter()
        .filter(|(n, _)| {
            n == "content-type"
                || ((n.starts_with("x-amz-") || n.starts_with("x-amzn-"))
                    && !REQUEST_ID_HEADERS.contains(&n.as_str()))
        })
        .cloned()
        .collect();
    headers.sort();
    headers
}

fn snippet(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let mut shown: String = text.chars().take(600).collect();
    if text.chars().count() > 600 {
        shown.push('…');
    }
    shown
}

/// Panics, naming the first difference, unless the two answers match (see the module documentation).
pub fn assert_matches_direct(ctx: &Ctx, what: &str, pair: &Pair, generated: &[&str]) {
    let (d, e) = (&pair.direct, &pair.engine);
    ctx.log(format!(
        "{what}: direct {} ({} bytes), engine {} ({} bytes)",
        d.status,
        d.body.len(),
        e.status,
        e.body.len()
    ));
    assert_eq!(
        e.status,
        d.status,
        "{what}: status through the engine {} differs from direct {}; engine body: {}; direct body: {}",
        e.status,
        d.status,
        snippet(&e.body),
        snippet(&d.body)
    );
    let (dh, eh) = (compared_headers(d), compared_headers(e));
    assert_eq!(
        eh,
        dh,
        "{what}: Content-Type and x-amz-*/x-amzn-* headers through the engine differ from direct \
         (status {} on both sides); engine body: {}; direct body: {}",
        e.status,
        snippet(&e.body),
        snippet(&d.body)
    );
    for (side, response) in [("direct", d), ("engine", e)] {
        if let Some(crc) = response.header("x-amz-crc32") {
            let actual = crc32fast::hash(&response.body).to_string();
            assert_eq!(
                crc, actual,
                "{what}: x-amz-crc32 of the {side} answer is not the CRC32 of its body"
            );
        }
    }
    let names: Vec<&str> = ALWAYS_GENERATED.iter().chain(generated).copied().collect();
    let (dn, en) = (normalize(&d.body, &names), normalize(&e.body, &names));
    if dn != en {
        let at = dn
            .iter()
            .zip(&en)
            .position(|(a, b)| a != b)
            .unwrap_or(dn.len().min(en.len()));
        let from = at.saturating_sub(80);
        panic!(
            "{what}: normalized body through the engine ({} bytes) differs from direct ({} bytes) at byte {at}: \
             engine …{}… direct …{}…",
            en.len(),
            dn.len(),
            snippet(&en[from..(at + 120).min(en.len())]),
            snippet(&dn[from..(at + 120).min(dn.len())])
        );
    }
}

fn name_matches(name: &str, pattern: &str) -> bool {
    if let Some(suffix) = pattern.strip_prefix('*') {
        name.ends_with(suffix)
    } else if let Some(prefix) = pattern.strip_suffix('*') {
        name.starts_with(prefix)
    } else {
        name == pattern
    }
}

/// The body with the text of every element whose name matches one of `names` replaced by `[generated]`.
pub fn normalize(body: &[u8], names: &[&str]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len());
    let mut rest = body;
    while let Some(open) = rest.iter().position(|b| *b == b'<') {
        out.extend_from_slice(&rest[..open]);
        rest = &rest[open..];
        let Some(close) = rest.iter().position(|b| *b == b'>') else {
            break;
        };
        let tag = &rest[1..close];
        let name = String::from_utf8_lossy(tag).into_owned();
        out.extend_from_slice(&rest[..=close]);
        rest = &rest[close + 1..];
        let plain = !name.is_empty()
            && !name.starts_with(['/', '?', '!'])
            && !name.ends_with('/')
            && !name.contains(char::is_whitespace);
        if plain && names.iter().any(|p| name_matches(&name, p)) {
            let end_tag = format!("</{name}>");
            if let Some(end) = rest
                .windows(end_tag.len())
                .position(|w| w == end_tag.as_bytes())
            {
                out.extend_from_slice(PLACEHOLDER.as_bytes());
                rest = &rest[end..];
            }
        }
    }
    out.extend_from_slice(rest);
    out
}

/// The text of every `<name>` element of an XML body, in order.
pub fn elements(body: &[u8], name: &str) -> Vec<String> {
    let text = String::from_utf8_lossy(body);
    let (open, close) = (format!("<{name}>"), format!("</{name}>"));
    let mut found = Vec::new();
    let mut rest: &str = &text;
    while let Some(start) = rest.find(&open) {
        rest = &rest[start + open.len()..];
        let Some(end) = rest.find(&close) else {
            break;
        };
        found.push(rest[..end].to_owned());
        rest = &rest[end + close.len()..];
    }
    found
}
