//! `engine.studio-relay-*`: AWS requests from the Studio origin with its session, through a real engine process
//! started with `--studio-port`, against the run's emulator (test-criteria.md, issue 10).
//!
//! The Studio form of a request (`support/studio.rs`) is what Chromium running Studio's SDK sends: signed with a
//! key the emulator does not know, the token in a signed `X-EmuForge-Session`, and the browser's own headers. Setup,
//! cleanup and every "what the emulator reports afterwards" go straight to the emulator (`support/fixtures.rs`);
//! only the request under test goes through the engine.

#[path = "../support/mod.rs"]
mod support;

use support::studio::{
    header_values, listed, pair_studio, session_token, studio_origin, studio_port,
    through_engine_as_studio,
};
use support::*;

/// The size of the upload of `engine.studio-relay-s3-put-object-matches-direct`.
const UPLOAD: usize = 64 * 1024;

/// The `Access-Control-Request-Headers` Chromium sends before an SDK request (test-criteria.md, "SDK preflight
/// headers").
const SDK_PREFLIGHT_HEADERS: &str = "amz-sdk-invocation-id,amz-sdk-request,authorization,content-type,\
     x-amz-checksum-crc32,x-amz-content-sha256,x-amz-date,x-amz-sdk-checksum-algorithm,x-amz-user-agent,\
     x-emuforge-session";

/// The engine started with `--studio-port <port>` (and `env`) against the run's emulator.
fn start_for_studio(ctx: &Ctx, port: u16, env: &[(&str, &str)]) -> Result<Engine, Env> {
    let mut cmd = EngineCmd::new(ctx)
        .arg("--studio-port")
        .arg(port.to_string());
    for (name, value) in env {
        cmd = cmd.env(name, *value);
    }
    Engine::start(ctx, cmd)
}

fn snippet(response: &Response) -> String {
    response.text().chars().take(600).collect()
}

/// `Access-Control-Allow-Origin` is present once and is exactly `origin`.
fn assert_allow_origin(response: &Response, origin: &str, what: &str) {
    assert_eq!(
        header_values(response, "access-control-allow-origin"),
        vec![origin],
        "{what}: Access-Control-Allow-Origin, expected exactly {origin} (status {})",
        response.status
    );
}

/// `Access-Control-Expose-Headers` names every one of `names` (lower-case header names).
fn assert_exposes(response: &Response, names: &[&str], what: &str) {
    let exposed: Vec<String> = listed(response, "access-control-expose-headers")
        .into_iter()
        .map(str::to_ascii_lowercase)
        .collect();
    let missing: Vec<&&str> = names
        .iter()
        .filter(|n| !exposed.iter().any(|e| e == *n))
        .collect();
    assert!(
        missing.is_empty(),
        "{what}: Access-Control-Expose-Headers does not name {missing:?}: {:?}",
        header_values(response, "access-control-expose-headers")
    );
}

/// `status` with the S3 XML error `<Code>code</Code>`.
fn assert_s3_error(response: &Response, status: u16, code: &str, what: &str) {
    assert_eq!(
        (response.status, elements(&response.body, "Code")),
        (status, vec![code.to_owned()]),
        "{what}: status and S3 XML <Code>, body {}",
        snippet(response)
    );
}

#[test]
fn studio_relay_s3_list_buckets_matches_direct() {
    check(
        "engine.studio-relay-s3-list-buckets-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-lb", prefix(ctx, "slb")))?;
            let p = studio_port(ctx)?;
            let origin = studio_origin(p);
            let _engine = start_for_studio(ctx, p, &[])?;
            let token = session_token(ctx, &origin);

            let what = "ListBuckets in the Studio form";
            let call = Call::s3("GET", "/?x-id=ListBuckets");
            let pair = pair_studio(ctx, what, &call, &Endpoint::engine(ctx), &origin, &token)?;
            assert_matches_direct(ctx, what, &pair, &[]);
            assert_eq!(pair.engine.status, 200, "{what}: status");
            assert!(
                pair.engine
                    .text()
                    .contains(&format!("<Name>{}</Name>", bucket.name)),
                "{what}: the engine's answer does not list {}: {}",
                bucket.name,
                snippet(&pair.engine)
            );
            assert_allow_origin(&pair.engine, &origin, what);
            let vary = listed(&pair.engine, "vary");
            assert!(
                vary.iter().any(|v| v.eq_ignore_ascii_case("Origin")),
                "{what}: Vary does not list Origin: {vary:?}"
            );
            assert_exposes(&pair.engine, &["x-amz-request-id", "x-amz-id-2"], what);
            Ok(())
        },
    );
}

#[test]
fn studio_relay_s3_put_object_matches_direct() {
    check("engine.studio-relay-s3-put-object-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-put", prefix(ctx, "sput")))?;
        let body = seeded(0x5eed_0010, UPLOAD);
        let p = studio_port(ctx)?;
        let origin = studio_origin(p);
        let _engine = start_for_studio(ctx, p, &[])?;
        let token = session_token(ctx, &origin);

        // The SDK's PutObject (§S.3): body hash in x-amz-content-sha256, CRC32 checksum.
        let put = |key: &str| {
            Call::s3("PUT", &format!("{}?x-id=PutObject", bucket.path(key)))
                .header("content-type", "application/octet-stream")
                .header("x-amz-checksum-crc32", &crc32_header(&body))
                .header("x-amz-sdk-checksum-algorithm", "CRC32")
                .body(body.clone())
        };
        bucket.track("k-engine");
        bucket.track("k-direct");
        let what = "PutObject k-direct directly";
        let from_direct = direct.send(what, &put("k-direct"))?;
        let what = "PutObject k-engine in the Studio form";
        let from_engine = through_engine_as_studio(
            ctx,
            what,
            &put("k-engine"),
            &Endpoint::engine(ctx),
            &origin,
            Some(&token),
        );
        assert_eq!(
            (from_engine.status, from_direct.status),
            (200, 200),
            "{what}: status through the engine and directly; engine body: {}",
            snippet(&from_engine)
        );
        let compared = |r: &Response| {
            let mut headers: Vec<(String, String)> = r
                .headers
                .iter()
                .filter(|(n, _)| {
                    n == "etag"
                        || n.starts_with("x-amz-checksum-")
                        || n == "x-amz-server-side-encryption"
                })
                .cloned()
                .collect();
            headers.sort();
            headers
        };
        assert_eq!(
            compared(&from_engine),
            compared(&from_direct),
            "{what}: ETag, x-amz-checksum-* and x-amz-server-side-encryption differ from direct"
        );
        assert_exposes(&from_engine, &["etag"], what);
        assert_allow_origin(&from_engine, &origin, what);

        let stored = direct.ok(
            "GetObject k-engine directly",
            &Call::s3("GET", &bucket.path("k-engine")),
        )?;
        assert_eq!(stored.status, 200, "GetObject k-engine directly: status");
        assert!(
            stored.body == body,
            "GetObject k-engine directly: {} bytes, not the uploaded {UPLOAD} bytes",
            stored.body.len()
        );
        Ok(())
    });
}

#[test]
fn studio_relay_sfn_list_state_machines_matches_direct() {
    check(
        "engine.studio-relay-sfn-list-state-machines-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            Direct::new(ctx)?;
            let p = studio_port(ctx)?;
            let origin = studio_origin(p);
            let _engine = start_for_studio(ctx, p, &[])?;
            let token = session_token(ctx, &origin);

            let what = "ListStateMachines in the Studio form";
            let call = Call::json("states", "AWSStepFunctions.ListStateMachines", "{}");
            let pair = pair_studio(ctx, what, &call, &Endpoint::engine(ctx), &origin, &token)?;
            assert_matches_direct(ctx, what, &pair, &[]);
            assert_eq!(pair.engine.status, 200, "{what}: status");
            assert_exposes(&pair.engine, &["x-amzn-requestid"], what);
            assert_allow_origin(&pair.engine, &origin, what);
            Ok(())
        },
    );
}

/// Deletes a bucket straight through the emulator on drop, if it exists (a missing bucket is ignored).
struct DeleteBucketOnDrop<'a> {
    direct: Direct<'a>,
    name: String,
}

impl Drop for DeleteBucketOnDrop<'_> {
    fn drop(&mut self) {
        let what = format!("cleanup DeleteBucket {}", self.name);
        match self
            .direct
            .send(&what, &Call::s3("DELETE", &format!("/{}", self.name)))
        {
            Ok(r) => self.direct.ctx.log(format!("{what}: {}", r.status)),
            Err(Env(e)) => self.direct.ctx.log(format!("{what}: {e}")),
        }
    }
}

#[test]
fn studio_relay_refuses_without_current_session() {
    check(
        "engine.studio-relay-refuses-without-current-session",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let b = format!("{}-b", prefix(ctx, "srs"));
            let head = Call::s3("HEAD", &format!("/{b}"));
            let exists = direct.send(&format!("HeadBucket {b} directly"), &head)?;
            if exists.status != 404 {
                return Err(Env::new(format!(
                    "bucket {b} must not exist before the check; HeadBucket directly answered {}",
                    exists.status
                )));
            }
            // Registered before the first PUT /B, so no run leaves B behind.
            let _cleanup = DeleteBucketOnDrop {
                direct: direct.clone(),
                name: b.clone(),
            };
            let p = studio_port(ctx)?;
            let origin = studio_origin(p);
            let engine_at = Endpoint::engine(ctx);
            let create = Call::s3("PUT", &format!("/{b}"));
            let head_status = |what: &str| -> Result<u16, Env> {
                Ok(direct
                    .send(&format!("HeadBucket {b} directly {what}"), &head)?
                    .status)
            };

            let mut first = start_for_studio(ctx, p, &[])?;
            let t1 = session_token(ctx, &origin);

            // Line 1: no token.
            let what = "CreateBucket in the Studio form without X-EmuForge-Session";
            let answer = through_engine_as_studio(ctx, what, &create, &engine_at, &origin, None);
            assert_s3_error(&answer, 401, "SessionRequired", what);
            assert_allow_origin(&answer, &origin, what);
            assert_eq!(
                head_status("after the CreateBucket without the token")?,
                404,
                "HeadBucket {b} directly after {what}: the bucket was created"
            );

            // Line 2: the engine restarted on the same ports; T1 is a token of the earlier process.
            first.stop(ctx);
            drop(first);
            let _second = start_for_studio(ctx, p, &[])?;
            let what = "CreateBucket in the Studio form with T1 after the engine restarted";
            let answer =
                through_engine_as_studio(ctx, what, &create, &engine_at, &origin, Some(&t1));
            assert_s3_error(&answer, 401, "SessionInvalid", what);
            assert_allow_origin(&answer, &origin, what);
            assert_eq!(
                head_status("after the CreateBucket with T1")?,
                404,
                "HeadBucket {b} directly after {what}: the bucket was created"
            );

            // Line 3: the new process's token.
            let t2 = session_token(ctx, &origin);
            let what = "CreateBucket in the Studio form with the new process's token T2";
            let answer =
                through_engine_as_studio(ctx, what, &create, &engine_at, &origin, Some(&t2));
            assert_eq!(
                answer.status,
                200,
                "{what}: status, body {}",
                snippet(&answer)
            );
            assert_eq!(
                head_status("after the CreateBucket with T2")?,
                200,
                "HeadBucket {b} directly after {what}"
            );
            Ok(())
        },
    );
}

#[test]
fn studio_relay_no_secret_in_output() {
    check("engine.studio-relay-no-secret-in-output", |ctx| {
        let ctx: &Ctx = ctx;
        // Reading the files registers the secret key for redaction; it is never printed.
        let files = EmulatorFiles::read(&emulator_dir(&ctx.home, ctx.emulator_port))
            .ok_or_else(|| Env::new("the run's emulator files are missing or incomplete"))?;
        let secret = files.secret_access_key.clone();
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-sec", prefix(ctx, "ssec")))?;
        bucket.track("k");
        let p = studio_port(ctx)?;
        let origin = studio_origin(p);
        let mut engine = start_for_studio(ctx, p, &[("RUST_LOG", "trace")])?;
        let token = session_token(ctx, &origin);
        let engine_at = Endpoint::engine(ctx);

        let list = Call::s3("GET", "/?x-id=ListBuckets");
        let studio_calls: Vec<(&str, Call, Option<&str>, u16)> = vec![
            ("ListBuckets", list.clone(), Some(token.as_str()), 200),
            (
                "PutObject k",
                Call::s3("PUT", &format!("{}?x-id=PutObject", bucket.path("k")))
                    .header("content-type", "application/octet-stream")
                    .body(b"studio-relay-no-secret-in-output".to_vec()),
                Some(token.as_str()),
                200,
            ),
            (
                "GetObject k",
                Call::s3("GET", &format!("{}?x-id=GetObject", bucket.path("k"))),
                Some(token.as_str()),
                200,
            ),
            (
                "GetObject of a missing key (NoSuchKey)",
                Call::s3("GET", &format!("{}?x-id=GetObject", bucket.path("missing"))),
                Some(token.as_str()),
                404,
            ),
            ("ListBuckets without the token", list, None, 401),
        ];
        // The When: each answer is the one the criteria name, so the absence lines below are reached only when the
        // requests were really relayed or refused.
        let mut answers: Vec<(String, Response)> = Vec::new();
        for (what, call, token, status) in &studio_calls {
            let what = format!("{what} in the Studio form");
            let answer = through_engine_as_studio(ctx, &what, call, &engine_at, &origin, *token);
            assert_eq!(
                answer.status,
                *status,
                "{what}: status, body {}",
                snippet(&answer)
            );
            answers.push((what, answer));
        }
        let what = "preflight OPTIONS / from the Studio origin".to_owned();
        let answer = Request::new("OPTIONS", "/")
            .header("Origin", &origin)
            .header("Access-Control-Request-Method", "GET")
            .header("Access-Control-Request-Headers", SDK_PREFLIGHT_HEADERS)
            .header("Sec-Fetch-Site", "same-site")
            .header("Sec-Fetch-Mode", "cors")
            .header("Sec-Fetch-Dest", "empty")
            .send(ctx, ctx.engine_port)
            .unwrap_or_else(|e| panic!("{what} got no answer: {e}"));
        assert_eq!(
            answer.status,
            204,
            "{what}: status, body {}",
            snippet(&answer)
        );
        answers.push((what, answer));
        let output = engine.stop(ctx);

        let mut leaks = Vec::new();
        for (name, text) in [("stdout", &output.stdout), ("stderr", &output.stderr)] {
            for (value, label) in [(&token, "the session token"), (&secret, "the secret key")] {
                if text.contains(value.as_str()) {
                    leaks.push(format!("the engine's {name} contains {label}"));
                }
            }
        }
        for (what, answer) in &answers {
            for (value, label) in [(&token, "the session token"), (&secret, "the secret key")] {
                for (n, v) in &answer.headers {
                    if n.contains(value.as_str()) || v.contains(value.as_str()) {
                        leaks.push(format!(
                            "header {n} of {what} ({}) contains {label}",
                            answer.status
                        ));
                    }
                }
                if answer
                    .body
                    .windows(value.len())
                    .any(|w| w == value.as_bytes())
                {
                    leaks.push(format!(
                        "body of {what} ({}) contains {label}",
                        answer.status
                    ));
                }
            }
        }
        assert!(leaks.is_empty(), "{}", leaks.join("\n"));
        Ok(())
    });
}
