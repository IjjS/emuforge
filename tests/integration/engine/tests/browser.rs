//! `engine.studio-*`: the engine's own routes as the Studio origin sees them through a real engine process: the
//! session token, the CORS preflight, health with the token, the studio port setting, a token per process, and a
//! token that never reaches the engine's output (test-criteria.md, issue 7).

#[path = "../support/mod.rs"]
mod support;

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use support::secrets;
use support::*;

/// The studio port the engine uses when none is set (requirement §3.1). No check takes it as its own studio port,
/// so a request from it is a request from an origin the engine was not configured with.
const DEFAULT_STUDIO_PORT: u16 = 8296;

/// The header that carries the session token (requirement §3.2).
const SESSION_HEADER: &str = "X-EmuForge-Session";

/// `http://127.0.0.1:<port>`, the only form a Studio origin takes (requirement §3.1).
fn origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// A free loopback port to use as a studio port: nothing listens on it now, and it is neither the engine port, the
/// run's emulator port, the default studio port nor one of `taken`.
fn studio_port(ctx: &Ctx, taken: &[u16]) -> Result<u16, Env> {
    for _ in 0..20 {
        let port = free_port()?;
        let reserved = [ctx.engine_port, ctx.emulator_port, DEFAULT_STUDIO_PORT];
        if !reserved.contains(&port) && !taken.contains(&port) {
            return Ok(port);
        }
    }
    Err(Env::new(
        "no free loopback port for a studio port after 20 tries",
    ))
}

/// The run's emulator answers its own health route with `200 ok`, checked directly, not through the engine.
fn require_run_emulator(ctx: &Ctx) -> Result<(), Env> {
    match direct_health(&ctx.home, ctx.emulator_port) {
        Ok((200, body)) if body == b"ok" => {
            ctx.log("run's emulator answers 200 ok directly");
            Ok(())
        }
        other => {
            let shown = other.map(|(s, b)| format!("{s} {}", String::from_utf8_lossy(&b)));
            Err(Env::new(format!(
                "run's emulator does not answer 200 ok directly: {shown:?}"
            )))
        }
    }
}

/// Sends `request` to the engine port; panics (verdict `failed`) when there is no complete answer.
fn send(ctx: &Ctx, request: Request, what: &str) -> Response {
    request
        .send(ctx, ctx.engine_port)
        .unwrap_or_else(|e| panic!("{what} got no answer: {e}"))
}

/// `GET /__emuforge/session` with `Origin: <from>`.
fn session(from: &str) -> Request {
    Request::get("/__emuforge/session").header("Origin", from)
}

/// `GET /__emuforge/health` with `Origin: <from>` and, when given, the token in `X-EmuForge-Session`.
fn health(from: &str, token: Option<&str>) -> Request {
    let request = Request::get("/__emuforge/health").header("Origin", from);
    match token {
        Some(token) => request.header(SESSION_HEADER, token),
        None => request,
    }
}

/// The CORS preflight a browser at `from` sends before `GET <path>` with the session header (requirement §2).
fn preflight(path: &str, from: &str) -> Request {
    Request::new("OPTIONS", path)
        .header("Origin", from)
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "x-emuforge-session")
}

/// Every value of a header, by case-insensitive name.
fn header_values<'a>(response: &'a Response, name: &str) -> Vec<&'a str> {
    let name = name.to_ascii_lowercase();
    response
        .headers
        .iter()
        .filter(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
        .collect()
}

/// `Access-Control-Allow-Origin` is present once and is exactly `expected`.
fn assert_allow_origin(response: &Response, expected: &str, what: &str) {
    let values = header_values(response, "access-control-allow-origin");
    assert_eq!(
        values,
        vec![expected],
        "{what}: Access-Control-Allow-Origin, expected exactly {expected}"
    );
}

/// No header of the answer is an `Access-Control-*` header.
fn assert_no_cors(response: &Response, what: &str) {
    let cors: Vec<&str> = response
        .headers
        .iter()
        .filter(|(n, _)| n.starts_with("access-control-"))
        .map(|(n, _)| n.as_str())
        .collect();
    assert!(
        cors.is_empty(),
        "{what}: expected no Access-Control-* header, got {cors:?}"
    );
}

/// `status` with #1's error body `{"error":{"code":"<code>",...}}`.
fn assert_error(response: &Response, status: u16, code: &str, what: &str) {
    assert_eq!(
        response.status,
        status,
        "{what}: status, body {}",
        response.text()
    );
    let body = response.json();
    assert_eq!(body["error"]["code"], code, "{what}: error code in {body}");
}

/// Whether a comma-separated header value lists `item` (compared with `eq`).
fn lists(value: Option<&str>, item: &str, eq: fn(&str, &str) -> bool) -> bool {
    value.is_some_and(|v| v.split(',').any(|part| eq(part.trim(), item)))
}

/// Whether `text` names `origin` as a whole origin, not as the start of one with a longer port.
fn names_origin(text: &str, origin: &str) -> bool {
    text.match_indices(origin).any(|(at, _)| {
        !text[at + origin.len()..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
    })
}

/// A JSON body that is exactly `{"token":"<64 lowercase hex>"}`; the token is registered for redaction before
/// anything about the body is asserted, so no message or log line can show it.
fn token_from(response: &Response, what: &str) -> String {
    let body: Option<serde_json::Value> = serde_json::from_slice(&response.body).ok();
    let token = body
        .as_ref()
        .and_then(|b| b.get("token"))
        .and_then(|t| t.as_str())
        .map(str::to_owned);
    if let Some(token) = &token {
        secrets::register([token.clone()]);
    }
    assert_eq!(
        response.status,
        200,
        "{what}: status, body {}",
        response.text()
    );
    let body = body.unwrap_or_else(|| panic!("{what}: body is not JSON: {}", response.text()));
    let keys: Vec<&String> = body
        .as_object()
        .map(|o| o.keys().collect())
        .unwrap_or_default();
    assert_eq!(
        keys,
        vec!["token"],
        "{what}: body is not {{\"token\":...}}: {body}"
    );
    let token = token.unwrap_or_else(|| panic!("{what}: token is not a string: {body}"));
    assert!(
        token.len() == 64
            && token
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "{what}: token is not 64 lowercase hexadecimal characters ({} characters)",
        token.len()
    );
    token
}

/// The engine started with `--studio-port <port>` against the run's emulator.
fn start_with_studio_port(ctx: &Ctx, port: u16) -> Result<Engine, Env> {
    Engine::start(
        ctx,
        EngineCmd::new(ctx)
            .arg("--studio-port")
            .arg(port.to_string()),
    )
}

#[test]
fn studio_session_serves_health() {
    check("engine.studio-session-serves-health", |ctx| {
        require_run_emulator(ctx)?;
        let p = studio_port(ctx, &[])?;
        let studio = origin(p);
        let mut engine = start_with_studio_port(ctx, p)?;

        // The session route gives the token to the Studio origin, with the CORS header naming it.
        let what = format!("GET /__emuforge/session with Origin {studio}");
        let answer = send(ctx, session(&studio), &what);
        let token = token_from(&answer, &what);
        assert_allow_origin(&answer, &studio, &what);

        // The preflight a browser sends before the health request with the session header.
        let what = format!("preflight OPTIONS /__emuforge/health from {studio}");
        let answer = send(ctx, preflight("/__emuforge/health", &studio), &what);
        assert_eq!(answer.status, 204, "{what}: status, body {}", answer.text());
        assert_allow_origin(&answer, &studio, &what);
        let methods = answer.header("access-control-allow-methods");
        assert!(
            lists(methods, "GET", |a, b| a == b),
            "{what}: Access-Control-Allow-Methods does not list GET: {methods:?}"
        );
        let headers = answer.header("access-control-allow-headers");
        assert!(
            lists(headers, SESSION_HEADER, |a, b| a.eq_ignore_ascii_case(b)),
            "{what}: Access-Control-Allow-Headers does not list {SESSION_HEADER}: {headers:?}"
        );

        // Health with the token: #1's answer for the run's emulator, readable by the Studio origin.
        let what = format!("GET /__emuforge/health with Origin {studio} and the token");
        let answer = send(ctx, health(&studio, Some(&token)), &what);
        assert_reachable(&answer, ctx.emulator_port);
        assert_allow_origin(&answer, &studio, &what);

        // Health without the token is refused, and the refusal is readable by the Studio origin.
        let what = format!("GET /__emuforge/health with Origin {studio} and no token");
        let answer = send(ctx, health(&studio, None), &what);
        assert_error(&answer, 401, "SessionRequired", &what);
        assert_allow_origin(&answer, &studio, &what);

        // The default studio port is not the configured one: its origin is a foreign origin.
        let default = origin(DEFAULT_STUDIO_PORT);
        let what = format!("GET /__emuforge/session with Origin {default}");
        let answer = send(ctx, session(&default), &what);
        assert_error(&answer, 403, "OriginNotAllowed", &what);
        assert_no_cors(&answer, &what);

        // The engine only compares Origin with the studio port; it does not listen there.
        let studio_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, p));
        match connect(ctx, studio_addr) {
            Err(e) if e.kind() == ErrorKind::ConnectionRefused => {
                ctx.log(format!("{studio_addr} refused"))
            }
            Err(e) => panic!("connect to {studio_addr}: expected refused, got {e}"),
            Ok(_) => panic!(
                "connect to {studio_addr} was accepted; the engine must not listen on the studio port"
            ),
        }

        // The start line names the Studio origin.
        let listen = format!("127.0.0.1:{}", ctx.engine_port);
        let start_line = wait_for(Duration::from_secs(2), || {
            engine
                .stderr_now()
                .lines()
                .find(|l| l.contains(&listen) && names_origin(l, &studio))
                .map(str::to_owned)
        });
        assert!(
            start_line.is_some(),
            "no stderr line names both {listen} and {studio}; stderr: {}",
            engine.stderr_now()
        );
        engine.stop(ctx);
        Ok(())
    });
}

/// One named start that the engine must refuse with a usage error.
struct Refusal {
    case: &'static str,
    cmd: EngineCmd,
    /// stderr must contain at least one of each group.
    names: Vec<Vec<&'static str>>,
}

#[test]
fn studio_port_from_environment() {
    check("engine.studio-port-from-environment", |ctx| {
        let p1 = studio_port(ctx, &[])?;
        let p2 = studio_port(ctx, &[p1])?;
        let (o1, o2) = (origin(p1), origin(p2));

        // The variable alone sets the studio port.
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx).env("EMUFORGE_STUDIO_PORT", p1.to_string()),
        )?;
        let what = format!("EMUFORGE_STUDIO_PORT={p1}: GET /__emuforge/session with Origin {o1}");
        let answer = send(ctx, session(&o1), &what);
        token_from(&answer, &what);
        engine.stop(ctx);
        drop(engine);

        // The flag wins over the variable.
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("EMUFORGE_STUDIO_PORT", p1.to_string())
                .arg("--studio-port")
                .arg(p2.to_string()),
        )?;
        let what = format!(
            "EMUFORGE_STUDIO_PORT={p1} --studio-port {p2}: GET /__emuforge/session with Origin {o2}"
        );
        let answer = send(ctx, session(&o2), &what);
        token_from(&answer, &what);
        let what = format!(
            "EMUFORGE_STUDIO_PORT={p1} --studio-port {p2}: GET /__emuforge/session with Origin {o1}"
        );
        let answer = send(ctx, session(&o1), &what);
        assert_error(&answer, 403, "OriginNotAllowed", &what);
        engine.stop(ctx);
        drop(engine);

        // Invalid settings are usage errors, before anything listens.
        let setting = vec!["EMUFORGE_STUDIO_PORT", "--studio-port"];
        let cases = vec![
            Refusal {
                case: "EMUFORGE_STUDIO_PORT=abc",
                cmd: EngineCmd::new(ctx).env("EMUFORGE_STUDIO_PORT", "abc"),
                names: vec![setting.clone()],
            },
            Refusal {
                case: "--studio-port equal to the engine port",
                cmd: EngineCmd::new(ctx)
                    .arg("--studio-port")
                    .arg(ctx.engine_port.to_string()),
                names: vec![setting.clone(), vec!["--port"]],
            },
        ];
        let mut failures = Vec::new();
        for Refusal { case, cmd, names } in cases {
            ensure_port_free(ctx.engine_port)?;
            let mut engine = cmd.spawn(ctx);
            let (status, listened) = engine.wait_exit(Duration::from_secs(5));
            let output = engine.stop(ctx);
            match status {
                None => failures.push(format!("{case}: still running 5 s after start")),
                Some(status) if status.code() != Some(2) => {
                    failures.push(format!("{case}: exited with {status}, expected code 2"))
                }
                Some(_) => {}
            }
            for group in &names {
                if !group.iter().any(|n| output.stderr.contains(n)) {
                    failures.push(format!(
                        "{case}: stderr names none of {group:?}: {}",
                        output.stderr.trim()
                    ));
                }
            }
            if listened {
                failures.push(format!(
                    "{case}: something listened on 127.0.0.1:{}",
                    ctx.engine_port
                ));
            }
            ctx.log(format!("case {case}: exit {status:?}"));
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
        Ok(())
    });
}

#[test]
fn studio_session_changes_on_restart() {
    check("engine.studio-session-changes-on-restart", |ctx| {
        require_run_emulator(ctx)?;
        let p = studio_port(ctx, &[])?;
        let studio = origin(p);

        let mut first = start_with_studio_port(ctx, p)?;
        let what = format!("first process: GET /__emuforge/session with Origin {studio}");
        let t1 = token_from(&send(ctx, session(&studio), &what), &what);
        first.stop(ctx);
        drop(first);

        let mut second = start_with_studio_port(ctx, p)?;
        let what = format!("second process: GET /__emuforge/health with Origin {studio} and T1");
        let answer = send(ctx, health(&studio, Some(&t1)), &what);
        assert_error(&answer, 401, "SessionInvalid", &what);
        assert_allow_origin(&answer, &studio, &what);

        let what = format!("second process: GET /__emuforge/session with Origin {studio}");
        let t2 = token_from(&send(ctx, session(&studio), &what), &what);
        assert_ne!(
            t2, t1,
            "the second process gave the same token as the first"
        );
        let what = format!("second process: GET /__emuforge/health with Origin {studio} and T2");
        let answer = send(ctx, health(&studio, Some(&t2)), &what);
        assert_eq!(answer.status, 200, "{what}: status, body {}", answer.text());
        second.stop(ctx);
        Ok(())
    });
}

#[test]
fn studio_session_not_in_output() {
    check("engine.studio-session-not-in-output", |ctx| {
        require_run_emulator(ctx)?;
        let p = studio_port(ctx, &[])?;
        let studio = origin(p);
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("RUST_LOG", "trace")
                .arg("--studio-port")
                .arg(p.to_string()),
        )?;

        let what = format!("GET /__emuforge/session with Origin {studio}");
        let session_answer = send(ctx, session(&studio), &what);
        let token = token_from(&session_answer, &what);

        let mut answers: Vec<(&str, Response)> = Vec::new();
        let what = "GET /__emuforge/health with the token in X-EmuForge-Session";
        let answer = send(ctx, health(&studio, Some(&token)), what);
        assert_eq!(answer.status, 200, "{what}: status, body {}", answer.text());
        answers.push((what, answer));
        let what = "GET /__emuforge/health with the token in the query";
        let request =
            Request::get(&format!("/__emuforge/health?session={token}")).header("Origin", &studio);
        answers.push((what, send(ctx, request, what)));
        let what = "GET /__emuforge/health with the token in Authorization: Bearer";
        let request = health(&studio, None).header("Authorization", &format!("Bearer {token}"));
        answers.push((what, send(ctx, request, what)));
        let what = "GET /__emuforge/health with the token and a foreign Origin";
        let request = health("https://example.com", Some(&token));
        answers.push((what, send(ctx, request, what)));
        let output = engine.stop(ctx);

        // Neither engine stream contains the token.
        let streams: Vec<&str> = [("stdout", &output.stdout), ("stderr", &output.stderr)]
            .into_iter()
            .filter(|(_, text)| text.contains(token.as_str()))
            .map(|(name, _)| name)
            .collect();
        assert!(
            streams.is_empty(),
            "the engine's {} contains the session token",
            streams.join(" and ")
        );

        // No answer but the session route's 200 body contains the token.
        let mut leaks = Vec::new();
        let in_headers = |response: &Response| {
            response
                .headers
                .iter()
                .filter(|(n, v)| n.contains(token.as_str()) || v.contains(token.as_str()))
                .map(|(n, _)| n.clone())
                .collect::<Vec<_>>()
        };
        for name in in_headers(&session_answer) {
            leaks.push(format!(
                "header {name} of the session answer contains the token"
            ));
        }
        for (what, answer) in &answers {
            for name in in_headers(answer) {
                leaks.push(format!(
                    "header {name} of {what} ({}) contains the token",
                    answer.status
                ));
            }
            if String::from_utf8_lossy(&answer.body).contains(token.as_str()) {
                leaks.push(format!(
                    "body of {what} ({}) contains the token",
                    answer.status
                ));
            }
        }
        assert!(leaks.is_empty(), "{}", leaks.join("\n"));
        Ok(())
    });
}
