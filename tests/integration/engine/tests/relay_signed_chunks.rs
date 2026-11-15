//! `engine.relay-s3-signed-chunk-*` checks (test-criteria.md, issue 9): header-signed S3 uploads whose body signs
//! each chunk (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`, `-PAYLOAD-TRAILER`) are relayed with the chunk chain the
//! emulator expects, and answered and stored as the same upload sent straight to the emulator with the emulator's
//! key and a correctly chained signature sequence (`support/chunked.rs`).
//!
//! Setup and cleanup go straight to the emulator (`support/fixtures.rs`); only the uploads under test go through
//! the engine.

#[path = "../support/mod.rs"]
mod support;

use std::time::Duration;

use support::*;

/// Every request through the engine is answered within this bound (test-criteria.md).
const ANSWER: Duration = Duration::from_secs(5);

/// How long after `docker restart` the engine may take to relay again (test-criteria.md).
const RESTART_BOUND: Duration = Duration::from_secs(30);

/// 64 KiB, the chunk size of most uploads below.
const KIB64: usize = 64 * 1024;

/// The engine's cap on one chunk's data (D3).
const CHUNK_DATA_CAP: usize = 1024 * 1024;

/// Generated elements of an S3 `403 SignatureDoesNotMatch` body (test-criteria.md, "matches direct").
const SIGNATURE_GENERATED: [&str; 4] = [
    "StringToSign",
    "SignatureProvided",
    "CanonicalRequest*",
    "*Bytes",
];

fn start_engine(ctx: &Ctx) -> Result<Engine, Env> {
    Engine::start(ctx, EngineCmd::new(ctx))
}

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

fn assert_status(what: &str, response: &Response, status: u16) {
    assert_eq!(
        response.status,
        status,
        "{what}: status, body {}",
        snippet(response)
    );
}

/// The direct `GetObject` of `key`: `200`, and no `Content-Encoding`.
fn stored(direct: &Direct, what: &str, bucket: &Bucket, key: &str) -> Result<Response, Env> {
    let object = direct.send(
        &format!("GetObject {key}"),
        &Call::s3("GET", &bucket.path(key)),
    )?;
    assert_status(&format!("{what}: GetObject of {key}"), &object, 200);
    assert_eq!(
        object.header("content-encoding"),
        None,
        "{what}: GetObject of {key} carries a Content-Encoding"
    );
    Ok(object)
}

/// "Matches direct" of a `PUT` (test-criteria.md): the two answers match, and a direct `GetObject` of `key` and of
/// `<key>-direct` returns the same bytes and the same `ETag`, with no `Content-Encoding`. Returns the bytes stored.
fn put_matches_direct(
    ctx: &Ctx,
    direct: &Direct,
    bucket: &Bucket,
    what: &str,
    upload: &SignedChunkUpload,
    key: &str,
    status: u16,
) -> Result<Vec<u8>, Env> {
    let direct_key = format!("{key}-direct");
    bucket.track(key);
    bucket.track(&direct_key);
    let p = signed_chunk_pair(
        ctx,
        what,
        &upload.to(&bucket.path(key)),
        &upload.to(&bucket.path(&direct_key)),
    )?;
    assert_matches_direct(ctx, what, &p, &[]);
    assert_status(&format!("{what}, through the engine"), &p.engine, status);
    let from_engine = stored(direct, what, bucket, key)?;
    let from_direct = stored(direct, what, bucket, &direct_key)?;
    assert!(
        from_engine.body == from_direct.body,
        "{what}: the object put through the engine ({} bytes) differs from the one put directly ({} bytes)",
        from_engine.body.len(),
        from_direct.body.len()
    );
    assert_eq!(
        from_engine.header("etag"),
        from_direct.header("etag"),
        "{what}: ETag of the object put through the engine differs from the one put directly"
    );
    Ok(from_engine.body)
}

#[test]
fn relay_s3_signed_chunk_put_matches_direct() {
    check("engine.relay-s3-signed-chunk-put-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-sc", prefix(ctx, "sc")))?;
        let _engine = start_engine(ctx)?;
        let data = seeded(0x5eed_0901, 70000);

        let what = "PutObject, 70000 bytes in 64 KiB signed chunks";
        let upload = SignedChunkUpload::put("/", data.clone(), KIB64);
        let bytes = put_matches_direct(ctx, &direct, &bucket, what, &upload, "k64", 200)?;
        assert!(
            bytes == data,
            "{what}: the object holds {} bytes, not the 70000 bytes sent",
            bytes.len()
        );

        let what = "PutObject, 70000 bytes in 1000-byte signed chunks";
        let upload = SignedChunkUpload::put("/", data.clone(), 1000);
        put_matches_direct(ctx, &direct, &bucket, what, &upload, "k1000", 200)?;

        let what = "PutObject, the empty object in signed chunks";
        let upload = SignedChunkUpload::put("/", Vec::new(), KIB64);
        let bytes = put_matches_direct(ctx, &direct, &bucket, what, &upload, "kempty", 200)?;
        assert!(
            bytes.is_empty(),
            "{what}: the object holds {} bytes",
            bytes.len()
        );

        let what = "PutObject, 70000 bytes in 64 KiB signed chunks, twice to the same key";
        bucket.track("ktwice");
        let twice = SignedChunkUpload::put(&bucket.path("ktwice"), data.clone(), KIB64);
        let first = through_engine(ctx, what, &twice.zeroed_call());
        assert_status(&format!("{what}, first"), &first, 200);
        let second = through_engine(ctx, what, &twice.zeroed_call());
        assert_status(&format!("{what}, second"), &second, 200);
        assert!(
            first.header("etag").is_some() && first.header("etag") == second.header("etag"),
            "{what}: ETag {:?} then {:?}",
            first.header("etag"),
            second.header("etag")
        );
        let object = stored(&direct, what, &bucket, "ktwice")?;
        assert!(
            object.body == data,
            "{what}: the object holds {} bytes, not the 70000 bytes sent",
            object.body.len()
        );
        Ok(())
    });
}

#[test]
fn relay_s3_signed_chunk_trailer_put_matches_direct() {
    check(
        "engine.relay-s3-signed-chunk-trailer-put-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-sct", prefix(ctx, "sct")))?;
            let _engine = start_engine(ctx)?;
            let data = seeded(0x5eed_0902, 70000);

            let what = "PutObject, 70000 bytes in 64 KiB signed chunks with a signed CRC32 trailer";
            let upload = SignedChunkUpload::put("/", data.clone(), KIB64).with_trailer();
            let bytes = put_matches_direct(ctx, &direct, &bucket, what, &upload, "k", 200)?;
            assert!(
                bytes == data,
                "{what}: the object holds {} bytes, not the 70000 bytes sent",
                bytes.len()
            );
            Ok(())
        },
    );
}

/// A multipart upload created directly; aborted directly on drop unless it was completed.
struct Upload<'a> {
    direct: &'a Direct<'a>,
    path: String,
    id: String,
    completed: bool,
}

impl<'a> Upload<'a> {
    fn create(direct: &'a Direct<'a>, bucket: &Bucket, key: &str) -> Result<Upload<'a>, Env> {
        bucket.track(key);
        let created = direct.ok(
            &format!("CreateMultipartUpload {key}"),
            &Call::s3("POST", &format!("{}?uploads", bucket.path(key))),
        )?;
        let id = elements(&created.body, "UploadId")
            .pop()
            .ok_or_else(|| Env::new("CreateMultipartUpload answered no UploadId"))?;
        Ok(Upload {
            direct,
            path: bucket.path(key),
            id: percent_encode(&id),
            completed: false,
        })
    }

    fn part_target(&self, n: u32) -> String {
        format!("{}?partNumber={n}&uploadId={}", self.path, self.id)
    }

    fn complete(&mut self, etag: &str) -> Result<(), Env> {
        let body = format!(
            "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>{etag}</ETag></Part>\
             </CompleteMultipartUpload>"
        );
        self.direct.ok(
            &format!("CompleteMultipartUpload {}", self.path),
            &Call::s3("POST", &format!("{}?uploadId={}", self.path, self.id))
                .body(body.into_bytes()),
        )?;
        self.completed = true;
        Ok(())
    }
}

impl Drop for Upload<'_> {
    fn drop(&mut self) {
        if !self.completed {
            let call = Call::s3("DELETE", &format!("{}?uploadId={}", self.path, self.id));
            match self
                .direct
                .send(&format!("AbortMultipartUpload {}", self.path), &call)
            {
                Ok(r) => self.direct.ctx.log(format!(
                    "cleanup AbortMultipartUpload {}: {}",
                    self.path, r.status
                )),
                Err(Env(e)) => self
                    .direct
                    .ctx
                    .log(format!("cleanup AbortMultipartUpload: {e}")),
            }
        }
    }
}

#[test]
fn relay_s3_signed_chunk_upload_part_matches_direct() {
    check(
        "engine.relay-s3-signed-chunk-upload-part-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-scp", prefix(ctx, "scp")))?;
            let mut through = Upload::create(&direct, &bucket, "k")?;
            let mut straight = Upload::create(&direct, &bucket, "k-direct")?;
            let _engine = start_engine(ctx)?;
            let data = seeded(0x5eed_0903, 70000);

            let what = "UploadPart 1, 70000 bytes in 64 KiB signed chunks";
            let upload = SignedChunkUpload::put("/", data.clone(), KIB64);
            let p = signed_chunk_pair(
                ctx,
                what,
                &upload.to(&through.part_target(1)),
                &upload.to(&straight.part_target(1)),
            )?;
            assert_matches_direct(ctx, what, &p, &[]);
            assert_status(&format!("{what}, through the engine"), &p.engine, 200);
            // The MD5 oracle answers RFC 1321's own vectors before it judges an ETag.
            for (input, expected) in [
                (&b""[..], "d41d8cd98f00b204e9800998ecf8427e"),
                (&b"abc"[..], "900150983cd24fb0d6963f7d28e17f72"),
            ] {
                if md5_hex(input) != expected {
                    return Err(Env::new(format!(
                        "md5_hex({:?}) is not the RFC 1321 vector {expected}",
                        String::from_utf8_lossy(input)
                    )));
                }
            }
            let md5 = format!("\"{}\"", md5_hex(&data));
            for (side, response) in [("through the engine", &p.engine), ("direct", &p.direct)] {
                assert_eq!(
                    response.header("etag"),
                    Some(md5.as_str()),
                    "{what}, {side}: the part's ETag is not the MD5 of the data"
                );
            }

            through.complete(&md5)?;
            straight.complete(&md5)?;
            for key in ["k", "k-direct"] {
                let object = stored(&direct, what, &bucket, key)?;
                assert!(
                    object.body == data,
                    "{what}: GetObject of {key} after CompleteMultipartUpload holds {} bytes, not the 70000 bytes sent",
                    object.body.len()
                );
            }
            Ok(())
        },
    );
}

/// What a malformed upload's error message must be.
enum Message {
    Exact(&'static str),
    /// Contains each of these.
    Naming(&'static [&'static str]),
    /// Any text: the code decides.
    Any,
}

/// One malformed upload of `engine.relay-s3-signed-chunk-malformed-matches-direct`.
struct MalformedCase {
    altered: &'static str,
    key: &'static str,
    malformed: Malformed,
    status: u16,
    code: &'static str,
    message: Message,
}

#[test]
fn relay_s3_signed_chunk_malformed_matches_direct() {
    check(
        "engine.relay-s3-signed-chunk-malformed-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-scm", prefix(ctx, "scm")))?;
            let _engine = start_engine(ctx)?;
            let data = seeded(0x5eed_0904, 70000);

            let cases = [
                MalformedCase {
                    altered: "the first chunk size written 1000g",
                    key: "badsize",
                    malformed: Malformed::FirstSize("1000g"),
                    status: 400,
                    code: "InvalidRequest",
                    message: Message::Exact(
                        "malformed request: aws-chunked body: invalid chunk size `1000g`",
                    ),
                },
                MalformedCase {
                    altered: "the first chunk's data one byte shorter than its size",
                    key: "short",
                    malformed: Malformed::FirstDataShort,
                    status: 400,
                    code: "InvalidRequest",
                    message: Message::Exact(
                        "malformed request: aws-chunked body: chunk data is not CRLF-terminated",
                    ),
                },
                MalformedCase {
                    altered: "the first chunk header without its chunk-signature extension",
                    key: "nosig",
                    malformed: Malformed::FirstNoSignature,
                    status: 403,
                    code: "SignatureDoesNotMatch",
                    message: Message::Any,
                },
                MalformedCase {
                    altered: "X-Amz-Decoded-Content-Length one more than the data",
                    key: "declen",
                    malformed: Malformed::DecodedLengthPlusOne,
                    status: 400,
                    code: "InvalidRequest",
                    message: Message::Naming(&["70001", "70000"]),
                },
            ];
            for case in cases {
                let MalformedCase {
                    altered,
                    key,
                    malformed,
                    status,
                    code,
                    message,
                } = case;
                let what = format!("PutObject in 64 KiB signed chunks, {altered}");
                let direct_key = format!("{key}-direct");
                bucket.track(key);
                bucket.track(&direct_key);
                let upload = SignedChunkUpload::put("/", data.clone(), KIB64).malformed(malformed);
                let p = signed_chunk_pair(
                    ctx,
                    &what,
                    &upload.to(&bucket.path(key)),
                    &upload.to(&bucket.path(&direct_key)),
                )?;
                assert_matches_direct(ctx, &what, &p, &SIGNATURE_GENERATED);
                assert_status(&format!("{what}, through the engine"), &p.engine, status);
                assert_eq!(
                    elements(&p.engine.body, "Code"),
                    [code],
                    "{what}, through the engine: S3 XML error code in {}",
                    snippet(&p.engine)
                );
                let text = elements(&p.engine.body, "Message").join("\n");
                match message {
                    Message::Exact(expected) => assert_eq!(
                        text, expected,
                        "{what}, through the engine: the error message"
                    ),
                    Message::Naming(parts) => {
                        for part in parts {
                            assert!(
                                text.contains(part),
                                "{what}, through the engine: the message {text:?} does not name {part}"
                            );
                        }
                    }
                    Message::Any => {}
                }
                for k in [key, direct_key.as_str()] {
                    let head = direct.send(
                        &format!("HeadObject {k}"),
                        &Call::s3("HEAD", &bucket.path(k)),
                    )?;
                    assert_eq!(
                        head.status, 404,
                        "{what}: HeadObject of {k} after the refused upload"
                    );
                }
            }
            Ok(())
        },
    );
}

#[test]
fn relay_s3_ecdsa_chunk_modes_pass_unchanged() {
    check("engine.relay-s3-ecdsa-chunk-modes-pass-unchanged", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-sce", prefix(ctx, "sce")))?;
        let _engine = start_engine(ctx)?;
        let data = seeded(0x5eed_0905, 70000);

        let what =
            "PutObject in STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD, 70000 bytes in 64 KiB chunks";
        let upload = SignedChunkUpload::put("/", data.clone(), KIB64).mode(ECDSA_CHUNKS);
        bucket.track("k");
        bucket.track("k-direct");
        // The same zero-signature body both ways: directly header-signed with the emulator's key.
        let from_direct = direct.send(what, &upload.to(&bucket.path("k-direct")).zeroed_call())?;
        let from_engine = through_engine(ctx, what, &upload.to(&bucket.path("k")).zeroed_call());
        let p = Pair {
            direct: from_direct,
            engine: from_engine,
        };
        assert_matches_direct(ctx, what, &p, &[]);
        assert_status(&format!("{what}, through the engine"), &p.engine, 200);
        let from_engine = stored(&direct, what, &bucket, "k")?;
        let from_direct = stored(&direct, what, &bucket, "k-direct")?;
        assert_eq!(
            from_engine.header("etag"),
            from_direct.header("etag"),
            "{what}: ETag of the object put through the engine differs from the one put directly"
        );
        assert!(
            from_engine.body == data && from_direct.body == data,
            "{what}: the objects hold {} (engine) and {} (direct) bytes, not the 70000 bytes sent",
            from_engine.body.len(),
            from_direct.body.len()
        );
        Ok(())
    });
}

#[test]
fn relay_s3_signed_chunk_above_cap_refused() {
    check("engine.relay-s3-signed-chunk-above-cap-refused", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-scc", prefix(ctx, "scc")))?;
        let _engine = start_engine(ctx)?;

        let what = "PutObject with one signed data chunk of 1048576 bytes";
        let at_cap = seeded(0x5eed_0906, CHUNK_DATA_CAP);
        bucket.track("atcap");
        let upload = SignedChunkUpload::put(&bucket.path("atcap"), at_cap.clone(), CHUNK_DATA_CAP);
        let answer = through_engine(ctx, what, &upload.zeroed_call());
        assert_status(&format!("{what}, through the engine"), &answer, 200);
        let object = stored(&direct, what, &bucket, "atcap")?;
        assert!(
            object.body == at_cap,
            "{what}: the object holds {} bytes, not the 1048576 bytes sent",
            object.body.len()
        );

        let above = seeded(0x5eed_0907, CHUNK_DATA_CAP + 1);
        let cases = [
            (
                "PutObject with one signed data chunk of 1048577 bytes",
                "abovecap",
                SignedChunkUpload::put("/", above.clone(), CHUNK_DATA_CAP + 1),
            ),
            (
                "PutObject with a 64 KiB signed data chunk, then one of 1048577 bytes",
                "aftercap",
                SignedChunkUpload::put("/", [seeded(0x5eed_0908, KIB64), above].concat(), KIB64)
                    .sizes(&[KIB64, CHUNK_DATA_CAP + 1]),
            ),
        ];
        for (i, (what, key, upload)) in cases.into_iter().enumerate() {
            bucket.track(key);
            let answer = through_engine(ctx, what, &upload.to(&bucket.path(key)).zeroed_call());
            assert_status(&format!("{what}, through the engine"), &answer, 400);
            assert_eq!(
                elements(&answer.body, "Code"),
                ["ChunkTooLarge"],
                "{what}, through the engine: S3 XML error code in {}",
                snippet(&answer)
            );
            if i == 0 {
                assert!(
                    answer
                        .header("connection")
                        .is_some_and(|v| v.eq_ignore_ascii_case("close")),
                    "{what}, through the engine: Connection {:?}, expected close",
                    answer.header("connection")
                );
                assert_in_time(what, &answer);
            }
            let head = direct.send(
                &format!("HeadObject {key}"),
                &Call::s3("HEAD", &bucket.path(key)),
            )?;
            assert_eq!(
                head.status, 404,
                "{what}: HeadObject of {key} after the refusal"
            );
        }
        Ok(())
    });
}

/// Buckets and objects created in an own emulator, deleted straight through it on drop with the key it holds
/// then.
struct OwnObjects<'a> {
    ctx: &'a Ctx,
    port: u16,
    /// Object paths first, then bucket paths, in deletion order.
    paths: Vec<String>,
}

impl Drop for OwnObjects<'_> {
    fn drop(&mut self) {
        let Ok(key) = Key::of_emulator(self.ctx, self.port) else {
            return;
        };
        let endpoint = Endpoint::emulator_on(self.ctx, self.port);
        for path in &self.paths {
            match Call::s3("DELETE", path).send(self.ctx, &endpoint, &key) {
                Ok(r) => self.ctx.log(format!("cleanup DELETE {path}: {}", r.status)),
                Err(e) => self.ctx.log(format!("cleanup DELETE {path}: {e}")),
            }
        }
    }
}

#[test]
fn relay_s3_signed_chunk_put_survives_emulator_restart() {
    check(
        "engine.relay-s3-signed-chunk-put-survives-emulator-restart",
        |ctx| {
            let ctx: &Ctx = ctx;
            let emulator = OwnEmulator::start(ctx)?;
            let bucket = format!("/{}-scr", prefix(ctx, "scr"));
            let (before, after) = (format!("{bucket}/before"), format!("{bucket}/after"));
            let _cleanup = OwnObjects {
                ctx,
                port: emulator.port,
                paths: vec![before.clone(), after.clone(), bucket.clone()],
            };
            let endpoint = Endpoint::emulator_on(ctx, emulator.port);
            let created = Call::s3("PUT", &bucket)
                .send(ctx, &endpoint, &Key::of_emulator(ctx, emulator.port)?)
                .map_err(|e| Env::new(format!("CreateBucket sent directly got no answer: {e}")))?;
            if created.status != 200 {
                return Err(Env::new(format!(
                    "CreateBucket sent directly answered {}",
                    created.status
                )));
            }
            let mut engine = Engine::start(
                ctx,
                EngineCmd::new(ctx)
                    .arg("--emulator-port")
                    .arg(emulator.port.to_string()),
            )?;
            let pid = engine.pid;
            let data = seeded(0x5eed_0909, 70000);

            let what = "PutObject in 64 KiB signed chunks before docker restart";
            let answer = through_engine(
                ctx,
                what,
                &SignedChunkUpload::put(&before, data.clone(), KIB64).zeroed_call(),
            );
            assert_status(&format!("{what}, through the engine"), &answer, 200);

            let ca = emulator.dir.join("ca.pem");
            let credentials = emulator.dir.join("emulator_credentials");
            let (ca_before, credentials_before) = (sha256_file(&ca)?, sha256_file(&credentials)?);
            emulator.restart(ctx)?;

            let what = "PutObject in 64 KiB signed chunks after docker restart";
            let upload = SignedChunkUpload::put(&after, data.clone(), KIB64);
            let mut last = None;
            let mut recreated = false;
            let relayed = wait_for(RESTART_BOUND, || {
                // The emulator keeps no state across a restart: the bucket is created again directly, with the
                // key the restarted emulator wrote, before the upload is sent through the engine.
                if !recreated {
                    let key = Key::of_emulator(ctx, emulator.port).ok()?;
                    let answer = Call::s3("PUT", &bucket).send(ctx, &endpoint, &key).ok()?;
                    if answer.status != 200 {
                        return None;
                    }
                    recreated = true;
                }
                let answer = through_engine(ctx, what, &upload.zeroed_call());
                assert_in_time(what, &answer);
                let ok = answer.status == 200;
                last = Some((answer.status, snippet(&answer)));
                ok.then_some(())
            });
            relayed.unwrap_or_else(|| {
            panic!(
                "{what}: no 200 through the engine within {} s of docker restart (bucket created again \
                 directly: {recreated}); last answer {:?}",
                RESTART_BOUND.as_secs(),
                last
            )
        });
            // Register the new keys for redaction before anything else is logged.
            EmulatorFiles::read(&emulator.dir);
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
            let object = Call::s3("GET", &after)
                .send(ctx, &endpoint, &Key::of_emulator(ctx, emulator.port)?)
                .map_err(|e| Env::new(format!("GetObject sent directly got no answer: {e}")))?;
            assert_status(&format!("{what}: GetObject"), &object, 200);
            assert!(
                object.body == data,
                "{what}: the object holds {} bytes, not the 70000 bytes sent",
                object.body.len()
            );
            engine.stop(ctx);
            Ok(())
        },
    );
}
