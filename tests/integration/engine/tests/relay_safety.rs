//! `engine.relay-*` safety checks (test-criteria.md, issue 2): the relay signs with the emulator's key and with
//! nothing from the process environment or `~/.aws` but the emulator's own files, stores uploads with an unsigned
//! trailer, connects to nothing but the emulator on loopback, and writes no secret, key id, signature or canary to its
//! output.
//!
//! Setup and cleanup go straight to the emulator (`support/fixtures.rs`); only the requests under test go
//! through the engine.

#[path = "../support/mod.rs"]
mod support;

use std::path::Path;
use std::time::{Duration, SystemTime};

use support::*;

/// Every request through the engine is answered within this bound (test-criteria.md).
const ANSWER: Duration = Duration::from_secs(5);

/// Size of the object the held download reads: large enough that the engine cannot pass it all into the
/// sockets' buffers while the check reads none of it, and within the emulator's 16 MiB `PutObject` limit.
const HELD_OBJECT: usize = 16 * 1024 * 1024;

fn through_engine(ctx: &Ctx, what: &str, call: &Call, key: &Key) -> Response {
    call.send(ctx, &Endpoint::engine(ctx), key)
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

/// S3 `ListBuckets`.
fn list_buckets() -> Call {
    Call::s3("GET", "/")
}

/// STS `GetCallerIdentity`, a query-protocol form.
fn get_caller_identity() -> Call {
    Call::query("sts", "Action=GetCallerIdentity&Version=2011-06-15")
}

#[test]
fn relay_signs_with_emulator_key() {
    check("engine.relay-signs-with-emulator-key", |ctx| {
        let ctx: &Ctx = ctx;

        // Given the engine started with the AWS variables set to decoys.
        let decoys = ctx.temp_dir()?;
        let credentials = decoys.path.join("credentials");
        let config = decoys.path.join("config");
        std::fs::write(
            &credentials,
            "[default]\naws_access_key_id = AKIADECOYDEFAULT0000\naws_secret_access_key = decoy-default-secret\n\
             [emuforge-decoy]\naws_access_key_id = AKIADECOYPROFILE0000\naws_secret_access_key = decoy-profile-secret\n",
        )
        .and_then(|_| {
            std::fs::write(
                &config,
                "[default]\nregion = us-east-1\n[profile emuforge-decoy]\nregion = us-east-1\n",
            )
        })
        .map_err(|e| Env::new(format!("cannot write the decoy files: {e}")))?;
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("AWS_PROFILE", "emuforge-decoy")
                .env("AWS_ACCESS_KEY_ID", "AKIADECOYENVIRONMENT")
                .env("AWS_SECRET_ACCESS_KEY", "decoy-environment-secret")
                .env("AWS_SESSION_TOKEN", "decoy-environment-session-token")
                .env(
                    "AWS_SHARED_CREDENTIALS_FILE",
                    credentials.display().to_string(),
                )
                .env("AWS_CONFIG_FILE", config.display().to_string()),
        )?;

        let refused = list_buckets()
            .send(ctx, &Endpoint::emulator(ctx), &Key::check())
            .map_err(|e| Env::new(format!("ListBuckets sent directly got no answer: {e}")))?;
        assert_eq!(
            refused.status,
            403,
            "ListBuckets signed with the check key, sent directly: status, body {}",
            snippet(&refused)
        );
        assert!(
            refused
                .text()
                .contains("Sign the request with the emulator credentials"),
            "ListBuckets signed with the check key, sent directly: body {}",
            snippet(&refused)
        );

        let listed = pair(ctx, "ListBuckets", &list_buckets())?;
        assert_eq!(
            listed.engine.status,
            200,
            "ListBuckets signed with the check key, through the engine: status, body {}",
            snippet(&listed.engine)
        );
        assert!(
            normalize(&listed.engine.body, &["RequestId", "HostId"])
                == normalize(&listed.direct.body, &["RequestId", "HostId"]),
            "ListBuckets through the engine: the body differs from the direct answer signed with the emulator key; \
             engine {}; direct {}",
            snippet(&listed.engine),
            snippet(&listed.direct)
        );

        let identity = through_engine(
            ctx,
            "GetCallerIdentity with a session token",
            &get_caller_identity(),
            &Key::check().with_session_token("emuforge-check-session-token"),
        );
        assert_eq!(
            identity.status,
            200,
            "GetCallerIdentity with a session token, through the engine: status, body {}",
            snippet(&identity)
        );
        assert_eq!(
            elements(&identity.body, "Arn"),
            ["arn:aws:iam::000000000000:user/emulator"],
            "GetCallerIdentity with a session token, through the engine: Arn"
        );
        engine.stop(ctx);

        // Given a home whose credential files are FIFOs, each holding one byte, write ends held by the check.
        let home = decoys.path.join("home");
        let emulators = home.join(".aws").join("emulator");
        std::fs::create_dir_all(&emulators)
            .map_err(|e| Env::new(format!("cannot create {}: {e}", emulators.display())))?;
        let link = emulators.join(ctx.emulator_port.to_string());
        std::os::unix::fs::symlink(emulator_dir(&ctx.home, ctx.emulator_port), &link)
            .map_err(|e| Env::new(format!("cannot link {}: {e}", link.display())))?;
        let paths = [
            home.join(".aws").join("credentials"),
            home.join(".aws").join("config"),
            decoys.path.join("shared-credentials-file"),
            decoys.path.join("config-file"),
        ];
        let mut fifos = Vec::new();
        for path in &paths {
            fifos.push(HeldFifo::create(path)?);
        }
        let mut engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("HOME", home.display().to_string())
                .env(
                    "AWS_SHARED_CREDENTIALS_FILE",
                    paths[2].display().to_string(),
                )
                .env("AWS_CONFIG_FILE", paths[3].display().to_string()),
        )?;

        let listed = through_engine(
            ctx,
            "ListBuckets with FIFO credential files",
            &list_buckets(),
            &Key::check(),
        );
        assert_eq!(
            listed.status,
            200,
            "ListBuckets with FIFO credential files, through the engine: status, body {}",
            snippet(&listed)
        );
        assert_in_time("ListBuckets with FIFO credential files", &listed);
        for fifo in &fifos {
            let name = fifo_name(&decoys.path, &fifo.path);
            let byte = fifo
                .read_back()
                .unwrap_or_else(|e| panic!("cannot read back {name}: {e}"));
            assert_eq!(
                byte,
                Some(HeldFifo::probe()),
                "{name}: the byte the check wrote is gone; another process opened it for reading and drained it"
            );
        }
        for mut fifo in fifos {
            fifo.close();
            let name = fifo_name(&decoys.path, &fifo.path);
            match open_write_nonblocking(&fifo.path) {
                Err(e) if e.raw_os_error() == Some(ENXIO) => {
                    ctx.log(format!("{name}: no reader holds it (ENXIO)"))
                }
                Err(e) => {
                    panic!("{name}: opening for writing with O_NONBLOCK: expected ENXIO, got {e}")
                }
                Ok(_) => panic!(
                    "{name}: opening for writing with O_NONBLOCK succeeded; a process holds it open for reading"
                ),
            }
        }
        engine.stop(ctx);
        std::fs::remove_file(&link).ok();
        Ok(())
    });
}

/// A FIFO's path relative to the check's temporary directory (`home/.aws/credentials`, `config-file`).
fn fifo_name(dir: &Path, path: &Path) -> String {
    path.strip_prefix(dir)
        .map(|p| format!("FIFO {}", p.display()))
        .unwrap_or_else(|_| format!("FIFO {}", path.display()))
}

#[test]
fn relay_s3_unsigned_trailer_upload_stored() {
    check("engine.relay-s3-unsigned-trailer-upload-stored", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-chk", prefix(ctx, "chk")))?;
        let _engine = Engine::start(ctx, EngineCmd::new(ctx))?;

        let decoded = seeded(0x5eed_0101, 100 * 1024);
        bucket.track("trailer");
        let trailer = Call::s3("PUT", &bucket.path("trailer"))
            .payload(Payload::Literal(
                "STREAMING-UNSIGNED-PAYLOAD-TRAILER".to_owned(),
            ))
            .header("Content-Encoding", "aws-chunked")
            .header("X-Amz-Trailer", "x-amz-checksum-crc32")
            .header("X-Amz-Decoded-Content-Length", &decoded.len().to_string())
            .body(aws_chunked_unsigned_trailer(&decoded, 64 * 1024));
        let stored = through_engine(
            ctx,
            "PutObject with an unsigned trailer",
            &trailer,
            &Key::check(),
        );
        assert_eq!(
            stored.status,
            200,
            "PutObject with an unsigned trailer, through the engine: status, body {}",
            snippet(&stored)
        );
        let object = direct.ok(
            "GetObject trailer",
            &Call::s3("GET", &bucket.path("trailer")),
        )?;
        assert!(
            object.body == decoded,
            "GetObject of the key put with an unsigned trailer: {} bytes, not the {} decoded bytes sent",
            object.body.len(),
            decoded.len()
        );
        Ok(())
    });
}

#[test]
fn relay_stays_on_loopback() {
    check("engine.relay-stays-on-loopback", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-lo", prefix(ctx, "lo")))?;
        bucket.put("held", seeded(0x5eed_0201, HELD_OBJECT))?;

        let describe = Call::json("dynamodb", "DynamoDB_20120810.DescribeEndpoints", "{}");
        // The Given names no emulator version's address: `200`, a non-empty `Endpoints[0].Address`, and not
        // the engine's own address, so that an equal body through the engine is the emulator's.
        let endpoints = direct.send("DescribeEndpoints", &describe)?;
        if endpoints.status != 200 {
            return Err(Env::new(format!(
                "DescribeEndpoints sent directly answered {}: {}; the Given does not hold",
                endpoints.status,
                snippet(&endpoints)
            )));
        }
        let address = serde_json::from_slice::<serde_json::Value>(&endpoints.body)
            .ok()
            .and_then(|b| b["Endpoints"][0]["Address"].as_str().map(str::to_owned))
            .filter(|a| !a.is_empty())
            .ok_or_else(|| {
                Env::new(format!(
                    "DescribeEndpoints sent directly names no endpoint address: {}; the Given does not hold",
                    snippet(&endpoints)
                ))
            })?;
        ctx.log(format!("DescribeEndpoints sent directly names {address}"));
        if address == format!("127.0.0.1:{}", ctx.engine_port) {
            return Err(Env::new(format!(
                "DescribeEndpoints sent directly names {address}, the engine's own address; the Given does not hold"
            )));
        }

        // The held download's head, recorded before the engine takes the port.
        let held_get = {
            let recorder = RequestRecorder::start(ctx.engine_port)?;
            let at = SystemTime::now();
            recorder.record(
                ctx,
                "GetObject held",
                &Call::s3("GET", &bucket.path("held")).at(at),
                &Key::check(),
            )?
        };

        let listener = CountingListener::start()?;
        let r = format!("http://127.0.0.1:{}", listener.port);
        let engine = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("HTTP_PROXY", r.clone())
                .env("HTTPS_PROXY", r.clone())
                .env("ALL_PROXY", r.clone())
                .env("AWS_ENDPOINT_URL", r.clone()),
        )?;

        matches_direct(ctx, "DescribeEndpoints", &describe, &[])?;
        matches_direct(ctx, "ListBuckets", &list_buckets(), &[])?;
        matches_direct(
            ctx,
            "GetObject of an absent key",
            &Call::s3("GET", &bucket.path("absent")),
            &[],
        )?;
        matches_direct(
            ctx,
            "unsigned GetObject",
            &Call::s3("GET", &bucket.path("absent")).unsigned(),
            &[],
        )?;
        assert_eq!(
            listener.accepted(),
            0,
            "the recording listener on 127.0.0.1:{} (proxy and endpoint variables) accepted connections",
            listener.port
        );

        let held = HeldResponse::open(ctx, ctx.engine_port, &held_get).unwrap_or_else(|e| {
            panic!("GetObject held open: the engine gave no response head: {e}")
        });
        assert_eq!(
            held.status, 200,
            "GetObject held open: status of the response head, head {}",
            held.head
        );
        let remotes = tcp_remotes(engine.pid)?;
        ctx.log(format!(
            "lsof: connections of engine pid {}: {remotes:?}",
            engine.pid
        ));
        let upstream = format!("127.0.0.1:{}", ctx.emulator_port);
        if !remotes.contains(&upstream) {
            return Err(Env::new(format!(
                "lsof lists no connection of the engine to {upstream} while the download is held; the Given does not hold \
                 (an engine that buffers the whole object and closes upstream before the client reads, against L2, \
                 also ends here)"
            )));
        }
        let foreign: Vec<&String> = remotes
            .iter()
            .filter(|r| r.rsplit_once(':').map(|(host, _)| host) != Some("127.0.0.1"))
            .collect();
        assert!(
            foreign.is_empty(),
            "lsof -nP -a -p {} -iTCP lists connections whose remote address is not 127.0.0.1: {foreign:?}",
            engine.pid
        );
        held.close();
        Ok(())
    });
}

/// Which of the run's secret values `text` contains, by name only.
fn names_in(text: &str, values: &[(&str, &str)]) -> Vec<String> {
    values
        .iter()
        .filter(|(_, value)| !value.is_empty() && text.contains(value))
        .map(|(name, _)| (*name).to_owned())
        .collect()
}

#[test]
fn relay_no_secret_in_output() {
    check("engine.relay-no-secret-in-output", |ctx| {
        let ctx: &Ctx = ctx;
        let files = EmulatorFiles::read(&emulator_dir(&ctx.home, ctx.emulator_port))
            .ok_or_else(|| Env::new("the run's emulator files are missing or incomplete"))?;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-sec", prefix(ctx, "sec")))?;
        bucket.put("k", b"no-secret-in-output".to_vec())?;
        let canary = format!(
            "efcanary{}x{}",
            prefix(ctx, "c").replace('-', ""),
            std::process::id()
        );
        let canary_key = format!("{canary}-path");
        bucket.track(&canary_key);

        let at = SystemTime::now();
        let check_key = Key::check();
        let token_key = Key::check().with_session_token("emuforge-check-session-token");
        let calls: Vec<(&str, Call, &Key)> = vec![
            ("ListBuckets", list_buckets().at(at), &check_key),
            (
                "presigned GetObject",
                Call::s3("GET", &bucket.path("k"))
                    .query_signed(Duration::from_secs(300))
                    .at(at),
                &check_key,
            ),
            (
                "GetCallerIdentity with X-Amz-Security-Token",
                get_caller_identity().at(at),
                &token_key,
            ),
            (
                "unsigned GetObject",
                Call::s3("GET", &bucket.path("k")).unsigned(),
                &check_key,
            ),
            (
                "PutObject with signed chunks",
                signed_chunk_put(&bucket.path("signed"), b"signed chunks are relayed").at(at),
                &check_key,
            ),
            (
                "PutObject with canaries",
                Call::s3("PUT", &bucket.path(&canary_key))
                    .header("User-Agent", &format!("{canary}-user-agent"))
                    .header("x-amz-meta-canary", &format!("{canary}-meta"))
                    .body(format!("{canary}-body").into_bytes())
                    .at(at),
                &check_key,
            ),
            (
                "GetObject with a canary query",
                Call::s3(
                    "GET",
                    &format!(
                        "{}?response-cache-control={canary}-query",
                        bucket.path(&canary_key)
                    ),
                )
                .at(at),
                &check_key,
            ),
        ];
        // The engine's own error answers; every other request is relayed, and is answered as the emulator answers
        // it, or the When of the criteria line has not happened.
        let own_errors: [&str; 0] = [];
        let relayed_status = |what: &str| match what {
            "unsigned GetObject" => 403,
            _ => 200,
        };
        bucket.track("signed");

        // The exact heads the engines will receive, recorded before they take the port.
        let mut heads = Vec::new();
        {
            let recorder = RequestRecorder::start(ctx.engine_port)?;
            for (what, call, key) in &calls {
                heads.push(recorder.record(ctx, what, call, key)?);
            }
        }
        let presigned_target = request_target(&heads[1]);
        let presigned_query = presigned_target
            .split_once('?')
            .map(|(_, q)| q.to_owned())
            .ok_or_else(|| Env::new("the presigned GetObject was recorded without a query"))?;
        let presigned_signature =
            query_value(&presigned_target, "X-Amz-Signature").ok_or_else(|| {
                Env::new("the presigned GetObject was recorded without X-Amz-Signature")
            })?;
        let authorizations: Vec<String> = heads
            .iter()
            .filter_map(|h| header_value(h, "authorization"))
            .collect();
        if authorizations.len() != 5 {
            return Err(Env::new(format!(
                "{} header-signed requests recorded with an Authorization header, expected 5",
                authorizations.len()
            )));
        }

        let mut bodies: Vec<(String, Vec<u8>, bool)> = Vec::new();
        let mut first = Engine::start(ctx, EngineCmd::new(ctx).env("RUST_LOG", "trace"))?;
        for (what, call, key) in &calls {
            let answer = through_engine(ctx, what, call, key);
            let own = own_errors.contains(what);
            if !own {
                assert_eq!(
                    answer.status,
                    relayed_status(what),
                    "{what}: not relayed to the emulator; status through the engine, body {}",
                    snippet(&answer)
                );
            }
            bodies.push(((*what).to_owned(), answer.body, own));
        }
        let first = first.stop(ctx);

        let p = free_port_without_emulator(&ctx.home)?;
        let mut second = Engine::start(
            ctx,
            EngineCmd::new(ctx)
                .env("RUST_LOG", "trace")
                .arg("--emulator-port")
                .arg(p.to_string()),
        )?;
        let not_started = through_engine(
            ctx,
            "ListBuckets to an engine on a not-started port",
            &calls[0].1,
            &check_key,
        );
        bodies.push((
            "ListBuckets to the second engine".to_owned(),
            not_started.body,
            true,
        ));
        let second = second.stop(ctx);

        let streams = [
            ("first engine stdout", &first.stdout),
            ("first engine stderr", &first.stderr),
            ("second engine stdout", &second.stdout),
            ("second engine stderr", &second.stderr),
        ];
        let mut leaks = Vec::new();

        let secret = [("aws_secret_access_key", files.secret_access_key.as_str())];
        for (name, text) in &streams {
            for found in names_in(text, &secret) {
                leaks.push(format!("{name} contains {found}"));
            }
        }
        for (name, body, _) in &bodies {
            for found in names_in(&String::from_utf8_lossy(body), &secret) {
                leaks.push(format!("the answer to {name} contains {found}"));
            }
        }

        let key_id = [(
            "the emulator's aws_access_key_id",
            files.access_key_id.as_str(),
        )];
        for (name, text) in &streams {
            for found in names_in(text, &key_id) {
                leaks.push(format!("{name} contains {found}"));
            }
        }
        for (name, body, own) in &bodies {
            if *own {
                for found in names_in(&String::from_utf8_lossy(body), &key_id) {
                    leaks.push(format!(
                        "the engine's own answer to {name} contains {found}"
                    ));
                }
            }
        }
        let mut sent: Vec<(String, String)> = vec![
            (
                "the presigned X-Amz-Signature value".to_owned(),
                presigned_signature,
            ),
            ("the presigned query string".to_owned(), presigned_query),
        ];
        for (i, value) in authorizations.iter().enumerate() {
            sent.push((format!("Authorization value {}", i + 1), value.clone()));
        }
        let sent: Vec<(&str, &str)> = sent.iter().map(|(n, v)| (n.as_str(), v.as_str())).collect();
        for (name, text) in &streams {
            for found in names_in(text, &sent) {
                leaks.push(format!("{name} contains {found}"));
            }
        }

        let canaries: Vec<(String, String)> = ["path", "query", "user-agent", "meta", "body"]
            .iter()
            .map(|part| (format!("the {part} canary"), format!("{canary}-{part}")))
            .collect();
        let canaries: Vec<(&str, &str)> = canaries
            .iter()
            .map(|(n, v)| (n.as_str(), v.as_str()))
            .collect();
        for (name, text) in &streams[..2] {
            for found in names_in(text, &canaries) {
                leaks.push(format!("{name} contains {found}"));
            }
        }

        assert!(
            leaks.is_empty(),
            "secrets, key ids, signatures or canaries in the engine's output: {}",
            leaks.join("; ")
        );
        Ok(())
    });
}
