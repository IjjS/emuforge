//! `engine.relay-*` lifecycle checks (test-criteria.md, issue 2): what a relayed request gets when the emulator is
//! not started, stopped, killed or restarted. The stopped, killed and restarted emulators are the check's own
//! (`OwnEmulator`), never the run's.

#[path = "../support/mod.rs"]
mod support;

use std::time::Duration;

use support::*;

/// Every request through the engine is answered within this bound (test-criteria.md).
const ANSWER: Duration = Duration::from_secs(5);

/// How long after `docker restart` the engine may take to relay again (test-criteria.md).
const RESTART_BOUND: Duration = Duration::from_secs(30);

fn through_engine(ctx: &Ctx, what: &str, call: &Call) -> Response {
    call.send(ctx, &Endpoint::engine(ctx), &Key::check())
        .unwrap_or_else(|e| panic!("{what}: the engine gave no answer: {e}"))
}

fn assert_in_time(what: &str, response: &Response) {
    assert!(
        response.elapsed < ANSWER,
        "{what}: answered in {} ms, expected under {} ms",
        response.elapsed.as_millis(),
        ANSWER.as_millis()
    );
}

fn snippet(response: &Response) -> String {
    response.text().chars().take(600).collect()
}

fn engine_for(ctx: &Ctx, emulator_port: u16) -> Result<Engine, Env> {
    Engine::start(
        ctx,
        EngineCmd::new(ctx)
            .arg("--emulator-port")
            .arg(emulator_port.to_string()),
    )
}

fn list_buckets() -> Call {
    Call::s3("GET", "/")
}

/// The media type of `Content-Type`, without parameters.
fn media_type(response: &Response) -> String {
    response
        .header("content-type")
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

/// The protocol shapes of requirement §6 (D7).
#[derive(Clone, Copy)]
enum Shape {
    /// `X-Amz-Target`: the request's JSON content type, `x-amzn-ErrorType`, `{"__type", "message"}`.
    Json(&'static str),
    /// Credential service `s3`: `application/xml`, `<Error><Code/><Message/></Error>`.
    RestXml,
    /// Form `POST`: `text/xml`, `<ErrorResponse><Error><Type/><Code/><Message/></Error></ErrorResponse>`.
    Query,
    /// Otherwise: `application/json`, `x-amzn-ErrorType`, `{"__type", "message"}`.
    RestJson,
}

/// The JSON and REST-JSON shape: `content_type`, `x-amzn-ErrorType` and `__type` `EmulatorUnavailable`; returns
/// `message`.
fn json_message(what: &str, response: &Response, content_type: &str) -> String {
    assert_eq!(media_type(response), content_type, "{what}: Content-Type");
    assert_eq!(
        response.header("x-amzn-errortype"),
        Some("EmulatorUnavailable"),
        "{what}: x-amzn-ErrorType"
    );
    let body: serde_json::Value = serde_json::from_slice(&response.body)
        .unwrap_or_else(|e| panic!("{what}: body is not JSON ({e}): {}", snippet(response)));
    assert_eq!(
        body["__type"], "EmulatorUnavailable",
        "{what}: __type in {body}"
    );
    body["message"]
        .as_str()
        .unwrap_or_else(|| panic!("{what}: no message in {body}"))
        .to_owned()
}

/// Asserts `503`, code `EmulatorUnavailable` in `shape`, a message naming `https://127.0.0.1:<port>` and
/// `reason`, answered within 5 s.
fn assert_unavailable(what: &str, response: &Response, shape: Shape, port: u16, reason: &str) {
    assert_eq!(
        response.status,
        503,
        "{what}: status, body {}",
        snippet(response)
    );
    assert_in_time(what, response);
    let message = match shape {
        Shape::Json(content_type) => json_message(what, response, content_type),
        Shape::RestJson => json_message(what, response, "application/json"),
        Shape::RestXml => {
            assert_eq!(
                media_type(response),
                "application/xml",
                "{what}: Content-Type"
            );
            assert!(
                response.text().contains("<Error>"),
                "{what}: not an S3 <Error> body: {}",
                snippet(response)
            );
            assert_eq!(
                elements(&response.body, "Code"),
                ["EmulatorUnavailable"],
                "{what}: Code in {}",
                snippet(response)
            );
            elements(&response.body, "Message")
                .pop()
                .unwrap_or_else(|| panic!("{what}: no Message in {}", snippet(response)))
        }
        Shape::Query => {
            assert_eq!(media_type(response), "text/xml", "{what}: Content-Type");
            assert!(
                response.text().contains("<ErrorResponse>"),
                "{what}: not a query <ErrorResponse> body: {}",
                snippet(response)
            );
            assert_eq!(
                elements(&response.body, "Type"),
                ["Receiver"],
                "{what}: Type in {}",
                snippet(response)
            );
            assert_eq!(
                elements(&response.body, "Code"),
                ["EmulatorUnavailable"],
                "{what}: Code in {}",
                snippet(response)
            );
            elements(&response.body, "Message")
                .pop()
                .unwrap_or_else(|| panic!("{what}: no Message in {}", snippet(response)))
        }
    };
    let endpoint = format!("https://127.0.0.1:{port}");
    assert!(
        message.contains(&endpoint) && message.contains(reason),
        "{what}: the message does not name {endpoint} and {reason}: {message}"
    );
}

#[test]
fn relay_reports_emulator_unavailable() {
    check("engine.relay-reports-emulator-unavailable", |ctx| {
        let ctx: &Ctx = ctx;

        // Given a port whose emulator directory does not exist.
        let p = free_port_without_emulator(&ctx.home)?;
        let mut engine = engine_for(ctx, p)?;
        let cases: [(&str, Call, Shape); 4] = [
            ("S3 ListBuckets", list_buckets(), Shape::RestXml),
            (
                "DynamoDB ListTables",
                Call::json("dynamodb", "DynamoDB_20120810.ListTables", "{}"),
                Shape::Json("application/x-amz-json-1.0"),
            ),
            (
                "IAM ListUsers",
                Call::query("iam", "Action=ListUsers&Version=2010-05-08"),
                Shape::Query,
            ),
            (
                "Lambda ListFunctions",
                Call::new("lambda", "GET", "/2015-03-31/functions/"),
                Shape::RestJson,
            ),
        ];
        for (what, call, shape) in &cases {
            let what = format!("{what} with the emulator not started");
            let answer = through_engine(ctx, &what, call);
            assert_unavailable(&what, &answer, *shape, p, "not_started");
        }
        engine.stop(ctx);

        // Given an own emulator, reachable through the engine; then stopped.
        let stopped = OwnEmulator::start(ctx)?;
        let mut engine = engine_for(ctx, stopped.port)?;
        let reachable = through_engine(ctx, "ListBuckets before docker stop", &list_buckets());
        assert_eq!(
            reachable.status,
            200,
            "ListBuckets before docker stop: status, body {}",
            snippet(&reachable)
        );
        stopped.stop(ctx)?;
        if stopped.dir.join("emulator_credentials").exists() {
            return Err(Env::new(
                "docker stop left the emulator's files behind; the Given (not started) does not hold",
            ));
        }
        let answer = through_engine(ctx, "ListBuckets after docker stop", &list_buckets());
        assert_unavailable(
            "ListBuckets after docker stop",
            &answer,
            Shape::RestXml,
            stopped.port,
            "not_started",
        );
        assert!(
            engine.is_running(),
            "the engine exited after the emulator stopped"
        );
        engine.stop(ctx);
        drop(stopped);

        // Given an own emulator, reachable through the engine; then killed.
        let killed = OwnEmulator::start(ctx)?;
        let mut engine = engine_for(ctx, killed.port)?;
        let reachable = through_engine(ctx, "ListBuckets before docker kill", &list_buckets());
        assert_eq!(
            reachable.status,
            200,
            "ListBuckets before docker kill: status, body {}",
            snippet(&reachable)
        );
        killed.kill(ctx)?;
        if !killed.dir.join("emulator_credentials").exists() {
            return Err(Env::new(
                "docker kill did not leave the emulator's files behind; the Given (killed) does not hold",
            ));
        }
        let answer = through_engine(ctx, "ListBuckets after docker kill", &list_buckets());
        assert_unavailable(
            "ListBuckets after docker kill",
            &answer,
            Shape::RestXml,
            killed.port,
            "connection_refused",
        );
        assert!(
            engine.is_running(),
            "the engine exited after the emulator was killed"
        );
        engine.stop(ctx);
        Ok(())
    });
}

/// Buckets created in an own emulator, deleted straight through it on drop with the key it holds then.
struct OwnBuckets<'a> {
    ctx: &'a Ctx,
    port: u16,
    names: Vec<String>,
}

impl Drop for OwnBuckets<'_> {
    fn drop(&mut self) {
        let Ok(key) = Key::of_emulator(self.ctx, self.port) else {
            return;
        };
        let endpoint = Endpoint::emulator_on(self.ctx, self.port);
        for name in &self.names {
            let outcome = Call::s3("DELETE", &format!("/{name}")).send(self.ctx, &endpoint, &key);
            match outcome {
                Ok(r) => self
                    .ctx
                    .log(format!("cleanup DeleteBucket {name}: {}", r.status)),
                Err(e) => self.ctx.log(format!("cleanup DeleteBucket {name}: {e}")),
            }
        }
    }
}

#[test]
fn relay_survives_emulator_restart() {
    check("engine.relay-survives-emulator-restart", |ctx| {
        let ctx: &Ctx = ctx;
        let emulator = OwnEmulator::start(ctx)?;
        let p = prefix(ctx, "rst");
        let mut buckets = OwnBuckets {
            ctx,
            port: emulator.port,
            names: Vec::new(),
        };
        let mut engine = engine_for(ctx, emulator.port)?;
        let pid = engine.pid;

        let before = format!("{p}-before");
        buckets.names.push(before.clone());
        let created = through_engine(
            ctx,
            "CreateBucket before docker restart",
            &Call::s3("PUT", &format!("/{before}")),
        );
        assert_eq!(
            created.status,
            200,
            "CreateBucket before docker restart, through the engine: status, body {}",
            snippet(&created)
        );
        let ca = emulator.dir.join("ca.pem");
        let credentials = emulator.dir.join("emulator_credentials");
        let (ca_before, credentials_before) = (sha256_file(&ca)?, sha256_file(&credentials)?);

        emulator.restart(ctx)?;

        let after = format!("{p}-after");
        buckets.names.push(after.clone());
        let mut created_after = false;
        let listed = wait_for(RESTART_BOUND, || {
            if !created_after {
                let answer = through_engine(
                    ctx,
                    "CreateBucket after docker restart",
                    &Call::s3("PUT", &format!("/{after}")),
                );
                assert_in_time("CreateBucket after docker restart", &answer);
                if answer.status != 200 {
                    return None;
                }
                created_after = true;
            }
            let answer = through_engine(ctx, "ListBuckets after docker restart", &list_buckets());
            assert_in_time("ListBuckets after docker restart", &answer);
            (answer.status == 200).then_some(answer)
        });
        let listed = listed.unwrap_or_else(|| {
            panic!(
                "CreateBucket and ListBuckets through the engine did not both answer 200 within {} s of docker restart \
                 (CreateBucket answered 200: {created_after})",
                RESTART_BOUND.as_secs()
            )
        });
        // Register the new keys for redaction before anything else is logged.
        EmulatorFiles::read(&emulator.dir);
        assert!(
            elements(&listed.body, "Name").contains(&after),
            "ListBuckets after docker restart does not list the bucket created after it: {}",
            snippet(&listed)
        );
        assert_ne!(
            sha256_file(&ca)?,
            ca_before,
            "ca.pem is unchanged after docker restart"
        );
        assert_ne!(
            sha256_file(&credentials)?,
            credentials_before,
            "emulator_credentials is unchanged after docker restart"
        );
        assert!(
            engine.is_running(),
            "the engine exited during the emulator restart"
        );
        assert_eq!(
            listening_pids(ctx.engine_port)?,
            [pid],
            "the process listening on the engine port is not the engine started before the restart"
        );
        engine.stop(ctx);
        drop(buckets);
        Ok(())
    });
}
