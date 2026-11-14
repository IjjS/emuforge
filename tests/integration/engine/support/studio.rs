//! The Studio origin's side of a relayed request (test-criteria.md, issue 10): the session token as Studio obtains
//! it, the Studio form of an AWS request, and the pairing of a Studio-form request through the engine with the plain
//! request sent straight to the emulator.
//!
//! The Studio form is what headless Chromium 158 running Studio's AWS SDK sends (`.pm/issue-10/evidence`, §S.3): the
//! request header-signed with a key the emulator does not know, `X-EmuForge-Session` among its signed headers, and,
//! unsigned, `Origin`, `Sec-Fetch-Site: same-site`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Dest: empty`, `sec-ch-ua`,
//! `sec-ch-ua-mobile`, `sec-ch-ua-platform`, a browser `User-Agent` and `Accept-Encoding`.

use crate::support::aws::{Call, Endpoint, Key};
use crate::support::check::{Ctx, Env};
use crate::support::http::{Request, Response};
use crate::support::net::free_port;
use crate::support::pair::Pair;
use crate::support::secrets;

/// The header that carries the session token (issue 7, requirement §3.2).
pub const SESSION_HEADER: &str = "X-EmuForge-Session";

/// The studio port the engine uses when none is set (issue 7, requirement §3.1); never taken as a check's own.
const DEFAULT_STUDIO_PORT: u16 = 8296;

/// The browser's own headers of §S.3, sent unsigned, as the browser adds them after the SDK has signed.
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) HeadlessChrome/158.0.8127.18 Safari/537.36";
const SEC_CH_UA: &str = r#""Chromium";v="158", "Not.A/Brand";v="24", "HeadlessChrome";v="158""#;
const ACCEPT_ENCODING: &str = "gzip, deflate, br, zstd";

/// `http://127.0.0.1:<port>`, the only form a Studio origin takes.
pub fn studio_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// A free loopback port to use as a studio port: nothing listens on it now, and it is neither the engine port, the
/// run's emulator port nor the default studio port. The engine never listens on it.
pub fn studio_port(ctx: &Ctx) -> Result<u16, Env> {
    for _ in 0..20 {
        let port = free_port()?;
        if ![ctx.engine_port, ctx.emulator_port, DEFAULT_STUDIO_PORT].contains(&port) {
            return Ok(port);
        }
    }
    Err(Env::new(
        "no free loopback port for a studio port after 20 tries",
    ))
}

/// The token from `GET /__emuforge/session` with `Origin: <origin>`, registered as a secret as soon as it is read,
/// before anything about the answer is asserted. Panics (verdict `failed`) unless the answer is `200` with a token.
pub fn session_token(ctx: &Ctx, origin: &str) -> String {
    let what = format!("GET /__emuforge/session with Origin {origin}");
    let answer = Request::get("/__emuforge/session")
        .header("Origin", origin)
        .send(ctx, ctx.engine_port)
        .unwrap_or_else(|e| panic!("{what} got no answer: {e}"));
    let token = serde_json::from_slice::<serde_json::Value>(&answer.body)
        .ok()
        .and_then(|b| b.get("token").and_then(|t| t.as_str()).map(str::to_owned));
    if let Some(token) = &token {
        secrets::register([token.clone()]);
    }
    assert_eq!(answer.status, 200, "{what}: status, body {}", answer.text());
    token.unwrap_or_else(|| panic!("{what}: no token in the body: {}", answer.text()))
}

/// `call` in the Studio form from `origin`, with `token` in a signed `X-EmuForge-Session` when given and without
/// that header when not.
pub fn studio_form(call: &Call, origin: &str, token: Option<&str>) -> Call {
    let call = match token {
        Some(token) => call.clone().header(SESSION_HEADER, token),
        None => call.clone(),
    };
    call.unsigned_header("Origin", origin)
        .unsigned_header("Sec-Fetch-Site", "same-site")
        .unsigned_header("Sec-Fetch-Mode", "cors")
        .unsigned_header("Sec-Fetch-Dest", "empty")
        .unsigned_header("sec-ch-ua", SEC_CH_UA)
        .unsigned_header("sec-ch-ua-mobile", "?0")
        .unsigned_header("sec-ch-ua-platform", r#""macOS""#)
        .unsigned_header("User-Agent", BROWSER_USER_AGENT)
        .unsigned_header("Accept-Encoding", ACCEPT_ENCODING)
}

/// Sends `call` in the Studio form through `engine` with the check key, signed with any key but the emulator's.
/// Panics when the engine gives no answer.
pub fn through_engine_as_studio(
    ctx: &Ctx,
    what: &str,
    call: &Call,
    engine: &Endpoint,
    origin: &str,
    token: Option<&str>,
) -> Response {
    studio_form(call, origin, token)
        .send(ctx, engine, &Key::check())
        .unwrap_or_else(|e| panic!("{what}: the engine gave no answer: {e}"))
}

/// The plain `call` sent directly (emulator key, emulator host), then `call` in the Studio form from `origin` with
/// `token` through `engine` with the check key (a key the emulator does not know). `Env` when the emulator gives no
/// answer; a failed assertion when the engine gives none. Compare the two with `assert_matches_direct`.
pub fn pair_studio(
    ctx: &Ctx,
    what: &str,
    call: &Call,
    engine: &Endpoint,
    origin: &str,
    token: &str,
) -> Result<Pair, Env> {
    let direct = call
        .send(
            ctx,
            &Endpoint::emulator(ctx),
            &Key::of_emulator(ctx, ctx.emulator_port)?,
        )
        .map_err(|e| Env::new(format!("{what}: the emulator gave no answer directly: {e}")))?;
    let engine = through_engine_as_studio(ctx, what, call, engine, origin, Some(token));
    Ok(Pair { direct, engine })
}

/// Every value of a header, by case-insensitive name.
pub fn header_values<'a>(response: &'a Response, name: &str) -> Vec<&'a str> {
    let name = name.to_ascii_lowercase();
    response
        .headers
        .iter()
        .filter(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
        .collect()
}

/// The elements of every comma-separated value of a header, trimmed, by case-insensitive header name.
pub fn listed<'a>(response: &'a Response, name: &str) -> Vec<&'a str> {
    header_values(response, name)
        .into_iter()
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect()
}
