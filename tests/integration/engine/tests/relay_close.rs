//! How the engine ends a client connection after an early answer (test-criteria.md, issue 22): a client that
//! finishes sending its body writes all of it, reads the whole answer and then sees the end of the stream, not a
//! reset, as it does straight from the emulator. Every request under test goes through the close client
//! (`support/close.rs`).
//!
//! Setup and cleanup go straight to the emulator (`support/fixtures.rs`). The heads sent through the engine are
//! header-signed with the check key and recorded by a `RequestRecorder` on the engine's port before the engine
//! starts.

#[path = "../support/mod.rs"]
mod support;

use std::time::SystemTime;

use support::*;

/// The engine's cap on one chunk's data (issue 9, D3).
const CHUNK_DATA_CAP: usize = 1024 * 1024;

/// The largest `Content-Length` the emulator answers after the whole body (requirement §1).
const EMULATOR_LENGTH_LIMIT: usize = 16 * 1024 * 1024;

/// New connections the above-cap upload is sent on (test-criteria.md).
const REPETITIONS: usize = 50;

fn start_engine(ctx: &Ctx) -> Result<Engine, Env> {
    Engine::start(ctx, EngineCmd::new(ctx))
}

/// The close client's exchange; a connection that cannot be set up is a failed assertion.
fn exchange(ctx: &Ctx, what: &str, endpoint: &Endpoint, head: &str, body: &[u8]) -> Exchange {
    close_exchange(ctx, what, endpoint, head, body)
        .unwrap_or_else(|e| panic!("{what}: no connection: {e}"))
}

fn snippet(response: &Response) -> String {
    response.text().chars().take(600).collect()
}

/// The answer of an exchange that wrote its whole body and ended with `eof`, with `status`.
fn assert_ended_cleanly<'a>(what: &str, x: &'a Exchange, status: u16) -> &'a Response {
    assert!(
        x.wrote_all(),
        "{what}: the body was not written whole: {}",
        x.summary()
    );
    let answer = x
        .answer
        .as_ref()
        .unwrap_or_else(|e| panic!("{what}: no whole answer ({e}): {}", x.summary()));
    assert_eq!(
        answer.status,
        status,
        "{what}: status, body {}; {}",
        snippet(answer),
        x.summary()
    );
    assert_eq!(
        x.end,
        End::Eof,
        "{what}: the stream did not end with eof: {}",
        x.summary()
    );
    answer
}

/// Why a repetition of the above-cap upload does not hold, or `None` when it does.
fn above_cap_fault(x: &Exchange) -> Option<String> {
    if !x.wrote_all() {
        return Some("the body was not written whole".to_owned());
    }
    let answer = match &x.answer {
        Ok(answer) => answer,
        Err(e) => return Some(format!("no whole answer ({e})")),
    };
    if answer.status != 400 {
        return Some(format!(
            "status {}, body {}",
            answer.status,
            snippet(answer)
        ));
    }
    if elements(&answer.body, "Code") != ["ChunkTooLarge"] {
        return Some(format!(
            "S3 XML error code is not ChunkTooLarge: {}",
            snippet(answer)
        ));
    }
    if !answer
        .header("connection")
        .is_some_and(|v| v.eq_ignore_ascii_case("close"))
    {
        return Some(format!(
            "Connection {:?}, expected close",
            answer.header("connection")
        ));
    }
    if x.end != End::Eof {
        return Some(format!("the stream ended with {}", x.end.name()));
    }
    None
}

#[test]
fn relay_s3_signed_chunk_above_cap_ends_cleanly() {
    check(
        "engine.relay-s3-signed-chunk-above-cap-ends-cleanly",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-scec", prefix(ctx, "scec")))?;
            bucket.track("abovecap");
            bucket.track("atcap");

            let above = SignedChunkUpload::put(
                &bucket.path("abovecap"),
                seeded(0x5eed_2201, CHUNK_DATA_CAP + 1),
                CHUNK_DATA_CAP + 1,
            );
            let at_cap_data = seeded(0x5eed_2202, CHUNK_DATA_CAP);
            let at_cap =
                SignedChunkUpload::put(&bucket.path("atcap"), at_cap_data.clone(), CHUNK_DATA_CAP);
            let (above_head, at_cap_head) = {
                let recorder = RequestRecorder::start(ctx.engine_port)?;
                let at = SystemTime::now();
                let above_head = recorder.record(
                    ctx,
                    "PutObject abovecap",
                    &above.zeroed_call().at(at),
                    &Key::check(),
                )?;
                let at_cap_head = recorder.record(
                    ctx,
                    "PutObject atcap",
                    &at_cap.zeroed_call().at(at),
                    &Key::check(),
                )?;
                (above_head, at_cap_head)
            };
            let _engine = start_engine(ctx)?;
            let engine = Endpoint::engine(ctx);

            let what = "PutObject with one signed data chunk of 1048577 bytes";
            let body = above.zeroed_body();
            let mut faults = Vec::new();
            for i in 1..=REPETITIONS {
                let x = exchange(
                    ctx,
                    &format!("{what}, {i} of {REPETITIONS}"),
                    &engine,
                    &above_head,
                    &body,
                );
                if let Some(fault) = above_cap_fault(&x) {
                    faults.push(format!("{i}: {fault}; {}", x.summary()));
                }
            }
            ctx.log(format!(
                "{what}: {} of {REPETITIONS} on new connections did not end cleanly",
                faults.len()
            ));
            assert!(
                faults.is_empty(),
                "{what}, through the engine: {} of {REPETITIONS} did not write the whole body, read 400 \
                 ChunkTooLarge with Connection: close and end with eof; first: {}",
                faults.len(),
                faults[0]
            );
            let head = direct.send(
                "HeadObject abovecap",
                &Call::s3("HEAD", &bucket.path("abovecap")),
            )?;
            assert_eq!(
                head.status, 404,
                "{what}: HeadObject of abovecap after the refusals"
            );

            let what = "PutObject with one signed data chunk of 1048576 bytes";
            let x = exchange(ctx, what, &engine, &at_cap_head, &at_cap.zeroed_body());
            assert_ended_cleanly(&format!("{what}, through the engine"), &x, 200);
            let object = direct.send("GetObject atcap", &Call::s3("GET", &bucket.path("atcap")))?;
            assert_eq!(
                object.status,
                200,
                "{what}: GetObject of atcap, body {}",
                snippet(&object)
            );
            assert!(
                object.body == at_cap_data,
                "{what}: the object holds {} bytes, not the 1048576 bytes sent",
                object.body.len()
            );
            Ok(())
        },
    );
}

#[test]
fn relay_early_answer_matches_direct() {
    check("engine.relay-early-answer-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-eam", prefix(ctx, "eam")))?;
        for key in ["early", "limit", "limit-direct"] {
            bucket.track(key);
        }

        let early_data = seeded(0x5eed_2203, EMULATOR_LENGTH_LIMIT + 1);
        let limit_data = seeded(0x5eed_2204, EMULATOR_LENGTH_LIMIT);
        let unsigned_put = |key: &str, data: &[u8]| {
            Call::s3("PUT", &bucket.path(key))
                .payload(Payload::Literal("UNSIGNED-PAYLOAD".to_owned()))
                .body(data.to_vec())
        };
        let (early_head, limit_head) = {
            let recorder = RequestRecorder::start(ctx.engine_port)?;
            let at = SystemTime::now();
            let early_head = recorder.record(
                ctx,
                "PutObject early",
                &unsigned_put("early", &early_data).at(at),
                &Key::check(),
            )?;
            let limit_head = recorder.record(
                ctx,
                "PutObject limit",
                &unsigned_put("limit", &limit_data).at(at),
                &Key::check(),
            )?;
            (early_head, limit_head)
        };
        let _engine = start_engine(ctx)?;
        let engine = Endpoint::engine(ctx);
        let emulator = Endpoint::emulator(ctx);
        let direct_head = |key: &str, length: usize| {
            direct_head(
                ctx,
                ctx.emulator_port,
                "PUT",
                &bucket.path(key),
                &[],
                "UNSIGNED-PAYLOAD",
                length,
            )
        };

        // The pair of one upload: straight to the emulator, then through the engine. `Env` when the emulator
        // gives no whole answer, since the reference would be missing.
        let both = |what: &str, direct_head: &str, engine_head: &str, data: &[u8], status: u16| {
            let d = exchange(
                ctx,
                &format!("{what}, directly"),
                &emulator,
                direct_head,
                data,
            );
            if let Err(e) = &d.answer {
                return Err(Env::new(format!(
                    "{what}: the emulator gave no whole answer directly ({e}): {}",
                    d.summary()
                )));
            }
            let e = exchange(
                ctx,
                &format!("{what}, through the engine"),
                &engine,
                engine_head,
                data,
            );
            assert_ended_cleanly(&format!("{what}, directly"), &d, status);
            assert_ended_cleanly(&format!("{what}, through the engine"), &e, status);
            let (Ok(direct), Ok(engine)) = (d.answer, e.answer) else {
                unreachable!("both answers were checked above");
            };
            Ok(Pair { direct, engine })
        };

        let what = "PutObject with Content-Length 16777217";
        let p = both(
            what,
            &direct_head("early", early_data.len())?,
            &early_head,
            &early_data,
            413,
        )?;
        assert_matches_direct(ctx, what, &p, &[]);
        let head = direct.send("HeadObject early", &Call::s3("HEAD", &bucket.path("early")))?;
        assert_eq!(
            head.status, 404,
            "{what}: HeadObject of early after the 413"
        );

        let what = "PutObject with Content-Length 16777216";
        let p = both(
            what,
            &direct_head("limit-direct", limit_data.len())?,
            &limit_head,
            &limit_data,
            200,
        )?;
        assert_matches_direct(ctx, what, &p, &[]);
        for key in ["limit", "limit-direct"] {
            let object = direct.send(
                &format!("GetObject {key}"),
                &Call::s3("GET", &bucket.path(key)),
            )?;
            assert_eq!(
                object.status,
                200,
                "{what}: GetObject of {key}, body {}",
                snippet(&object)
            );
            assert!(
                object.body == limit_data,
                "{what}: {key} holds {} bytes, not the 16777216 bytes sent",
                object.body.len()
            );
        }
        Ok(())
    });
}
