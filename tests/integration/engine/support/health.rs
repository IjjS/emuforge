//! The engine's health endpoint as a caller sees it (requirement §3): `GET /__emuforge/health` and the shape
//! of its answer.

use crate::support::check::Ctx;
use crate::support::http::{ANSWER_BOUND, Request, Response};

/// `GET /__emuforge/health` on `127.0.0.1:<port>` with the address's own `Host`. Panics (verdict `failed`)
/// when the engine gives no complete answer within 5 s.
pub fn get_health(ctx: &Ctx, port: u16) -> Response {
    Request::get("/__emuforge/health")
        .send(ctx, port)
        .unwrap_or_else(|e| panic!("GET /__emuforge/health on 127.0.0.1:{port} got no answer: {e}"))
}

/// The answer was given within 5 s.
pub fn assert_answered_in_time(response: &Response) {
    assert!(
        response.elapsed < ANSWER_BOUND,
        "health answered in {} ms, expected under {} ms",
        response.elapsed.as_millis(),
        ANSWER_BOUND.as_millis()
    );
}

/// `200`, `reachable: true`, `port` and `endpoint` of the emulator on `emulator_port`.
pub fn assert_reachable(response: &Response, emulator_port: u16) {
    assert_eq!(
        response.status,
        200,
        "health status, body {}",
        response.text()
    );
    let body = response.json();
    let emulator = &body["emulator"];
    assert_eq!(emulator["reachable"], true, "emulator.reachable in {body}");
    assert_eq!(emulator["port"], emulator_port, "emulator.port in {body}");
    assert_eq!(
        emulator["endpoint"],
        format!("https://127.0.0.1:{emulator_port}"),
        "emulator.endpoint in {body}"
    );
}

/// `503`, `reachable: false`, `reason: <reason>`, `port` and `endpoint` of the emulator on `emulator_port`.
pub fn assert_unreachable(response: &Response, reason: &str, emulator_port: u16) {
    assert_eq!(
        response.status,
        503,
        "health status, body {}",
        response.text()
    );
    let body = response.json();
    let emulator = &body["emulator"];
    assert_eq!(emulator["reachable"], false, "emulator.reachable in {body}");
    assert_eq!(emulator["reason"], reason, "emulator.reason in {body}");
    assert_eq!(emulator["port"], emulator_port, "emulator.port in {body}");
    assert_eq!(
        emulator["endpoint"],
        format!("https://127.0.0.1:{emulator_port}"),
        "emulator.endpoint in {body}"
    );
}

/// `200` with `reachable: true`, without asserting: for waits that poll until the emulator is reachable.
pub fn is_reachable(response: &Response) -> bool {
    response.status == 200
        && serde_json::from_slice::<serde_json::Value>(&response.body)
            .is_ok_and(|b| b["emulator"]["reachable"] == true)
}
