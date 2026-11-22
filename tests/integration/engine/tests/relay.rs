//! `engine.relay-*` transparency checks (test-criteria.md, issue 2): a request sent through the engine,
//! signed with the check key, answers as the same request sent straight to the emulator, signed with the
//! emulator's key, against the same emulator state ("matches direct", `support/pair.rs`).
//!
//! Setup and cleanup go straight to the emulator (`support/fixtures.rs`); only the request under test goes
//! through the engine.

#[path = "../support/mod.rs"]
mod support;

use std::time::{Duration, SystemTime};

use support::*;

/// The size of the streamed download (test-criteria.md).
const LARGE: usize = 32 * 1024 * 1024;

/// The size of the streamed upload: 16 MiB, since emulator v1.0.364 answers `413` to a `PutObject` over
/// 16 MiB, sent directly too (`.pm/issue-2/decisions.md`, PM decisions, criteria correction; the manifest row
/// notes it as `emulator_gap`).
const LARGE_UPLOAD: usize = 16 * 1024 * 1024;

/// Part size of the multipart upload that creates the 32 MiB object directly.
const PART: usize = 16 * 1024 * 1024;

/// How many pages the paginated list may take before the check gives up (3 objects, 1 per page).
const PAGE_BOUND: usize = 10;

/// How long a message sent through the engine may take to be received directly.
const RECEIVE_BOUND: Duration = Duration::from_secs(5);

fn start_engine(ctx: &Ctx) -> Result<Engine, Env> {
    Engine::start(ctx, EngineCmd::new(ctx))
}

/// The engine's answer, by name: the response of the request sent through the engine.
fn through_engine(ctx: &Ctx, what: &str, call: &Call) -> Response {
    call.send(ctx, &Endpoint::engine(ctx), &Key::check())
        .unwrap_or_else(|e| panic!("{what}: the engine gave no answer: {e}"))
}

fn assert_error_status(what: &str, pair: &Pair) {
    for (side, r) in [("direct", &pair.direct), ("engine", &pair.engine)] {
        assert!(
            r.status >= 400,
            "{what}: the {side} answer is {}, expected 400 or above",
            r.status
        );
    }
}

fn text_contains(what: &str, response: &Response, needle: &str) {
    assert!(
        response.text().contains(needle),
        "{what}: the engine's answer does not contain {needle}: {}",
        response.text().chars().take(600).collect::<String>()
    );
}

#[test]
fn relay_s3_list_buckets_matches_direct() {
    check("engine.relay-s3-list-buckets-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-lb", prefix(ctx, "lb")))?;
        let _engine = start_engine(ctx)?;

        let pair = matches_direct(ctx, "ListBuckets", &Call::s3("GET", "/"), &[])?;
        text_contains(
            "ListBuckets",
            &pair.engine,
            &format!("<Name>{}</Name>", bucket.name),
        );
        Ok(())
    });
}

#[test]
fn relay_s3_put_object_streams_body() {
    check("engine.relay-s3-put-object-streams-body", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-put", prefix(ctx, "put")))?;
        let body = seeded(0x5eed_0002, LARGE_UPLOAD);
        let _engine = start_engine(ctx)?;

        // The AWS CLI 2.34.53 header set of a PutObject (evidence §E-I).
        let put = |key: &str| {
            Call::s3("PUT", &bucket.path(key))
                .header("x-amz-checksum-crc64nvme", &crc64nvme_header(&body))
                .header("x-amz-sdk-checksum-algorithm", "CRC64NVME")
                .body(body.clone())
                .expect_continue()
        };
        bucket.track("k");
        bucket.track("k-direct");
        let from_direct = direct.send("PutObject k-direct", &put("k-direct"))?;
        let from_engine = through_engine(ctx, "PutObject k", &put("k"));
        assert_eq!(
            from_engine.status,
            from_direct.status,
            "PutObject: status through the engine {} differs from direct {}; engine body: {}",
            from_engine.status,
            from_direct.status,
            from_engine.text()
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
            "PutObject: ETag, x-amz-checksum-* and x-amz-server-side-encryption through the engine differ from direct"
        );
        let stored = direct.ok("GetObject k", &Call::s3("GET", &bucket.path("k")))?;
        assert_eq!(
            stored.body.len(),
            body.len(),
            "GetObject of the key put through the engine: length"
        );
        assert!(
            stored.body == body,
            "GetObject of the key put through the engine: the bytes differ from those sent"
        );

        // A body hash of other bytes: refused on both sides, nothing stored.
        bucket.track("k2");
        let mismatched = Call::s3("PUT", &bucket.path("k2"))
            .payload(Payload::HashOf(seeded(0x5eed_0003, 1024)))
            .body(seeded(0x5eed_0004, 1024));
        let refused = matches_direct(
            ctx,
            "PutObject k2 with the hash of other bytes",
            &mismatched,
            &[
                "StringToSign",
                "SignatureProvided",
                "*Bytes",
                "CanonicalRequest*",
            ],
        )?;
        assert_eq!(
            refused.engine.status, 403,
            "PutObject k2 with the hash of other bytes: status"
        );
        text_contains(
            "PutObject k2 with the hash of other bytes",
            &refused.engine,
            "<Code>SignatureDoesNotMatch</Code>",
        );
        let head = direct.send("HeadObject k2", &Call::s3("HEAD", &bucket.path("k2")))?;
        assert_eq!(
            head.status, 404,
            "HeadObject k2 after the refused PutObject"
        );
        Ok(())
    });
}

#[test]
fn relay_s3_get_object_streams_body() {
    check("engine.relay-s3-get-object-streams-body", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-get", prefix(ctx, "get")))?;
        let object = seeded(0x5eed_0001, LARGE);
        // One PutObject takes at most 16 MiB on emulator v1.0.364; the 32 MiB object is put in two parts.
        bucket.put_multipart("k", &object, PART)?;
        let _engine = start_engine(ctx)?;

        let whole = matches_direct(ctx, "GetObject", &Call::s3("GET", &bucket.path("k")), &[])?;
        assert_eq!(
            whole.engine.header("content-length"),
            Some("33554432"),
            "GetObject through the engine: Content-Length"
        );
        assert!(
            whole.engine.body == object,
            "GetObject through the engine: the bytes differ from the object"
        );

        let range = matches_direct(
            ctx,
            "GetObject bytes=100-199",
            &Call::s3("GET", &bucket.path("k")).header("Range", "bytes=100-199"),
            &[],
        )?;
        assert!(
            range.engine.body == object[100..200],
            "GetObject bytes=100-199 through the engine: not the 100 bytes at offset 100 ({} bytes)",
            range.engine.body.len()
        );

        let head = matches_direct(ctx, "HeadObject", &Call::s3("HEAD", &bucket.path("k")), &[])?;
        assert!(
            head.engine.body.is_empty(),
            "HeadObject through the engine carried {} body bytes",
            head.engine.body.len()
        );
        Ok(())
    });
}

#[test]
fn relay_s3_list_objects_paginates() {
    check("engine.relay-s3-list-objects-paginates", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-list", prefix(ctx, "list")))?;
        for key in ["k1", "k2", "k3"] {
            bucket.put(key, key.as_bytes().to_vec())?;
        }
        let listed = direct.ok(
            "ListObjectsV2",
            &Call::s3("GET", &format!("/{}?list-type=2", bucket.name)),
        )?;
        let expected = elements(&listed.body, "Key");
        if expected.len() != 3 {
            return Err(Env::new(format!(
                "ListObjectsV2 sent directly lists {} keys, expected the 3 put",
                expected.len()
            )));
        }
        let _engine = start_engine(ctx)?;

        let first = matches_direct(
            ctx,
            "ListObjectsV2 max-keys=1",
            &Call::s3("GET", &format!("/{}?list-type=2&max-keys=1", bucket.name)),
            &[],
        )?;
        assert_eq!(
            elements(&first.engine.body, "IsTruncated"),
            ["true"],
            "ListObjectsV2 max-keys=1: IsTruncated"
        );
        let mut token = elements(&first.engine.body, "NextContinuationToken")
            .pop()
            .unwrap_or_else(|| panic!("ListObjectsV2 max-keys=1: no NextContinuationToken"));

        let mut seen = elements(&first.engine.body, "Key");
        for page in 2..=PAGE_BOUND {
            let target = format!(
                "/{}?list-type=2&max-keys=1&continuation-token={}",
                bucket.name,
                percent_encode(&token)
            );
            let answer = through_engine(
                ctx,
                &format!("ListObjectsV2 page {page}"),
                &Call::s3("GET", &target),
            );
            assert_eq!(
                answer.status,
                200,
                "ListObjectsV2 page {page}: status, body {}",
                answer.text()
            );
            seen.extend(elements(&answer.body, "Key"));
            if elements(&answer.body, "IsTruncated") == ["false"] {
                assert_eq!(
                    seen, expected,
                    "keys seen through the engine, in order, against the keys listed directly"
                );
                return Ok(());
            }
            token = elements(&answer.body, "NextContinuationToken")
                .pop()
                .unwrap_or_else(|| {
                    panic!("ListObjectsV2 page {page}: truncated without a NextContinuationToken")
                });
        }
        panic!("ListObjectsV2 through the engine was still truncated after {PAGE_BOUND} pages");
    });
}

#[test]
fn relay_s3_presigned_get_object_matches_direct() {
    check(
        "engine.relay-s3-presigned-get-object-matches-direct",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let bucket = Bucket::create(&direct, &format!("{}-pre", prefix(ctx, "pre")))?;
            let object = seeded(0x5eed_0005, 12_000);
            bucket.put("k", object.clone())?;
            let _engine = start_engine(ctx)?;

            // Each side's URL is query-signed for its own host with its own key.
            let presigned =
                Call::s3("GET", &bucket.path("k")).query_signed(Duration::from_secs(300));
            let fresh = matches_direct(ctx, "presigned GetObject", &presigned, &[])?;
            assert!(
                fresh.engine.status == 200 && fresh.engine.body == object,
                "presigned GetObject through the engine: status {}, {} bytes, expected 200 and the object",
                fresh.engine.status,
                fresh.engine.body.len()
            );

            let signed_at = SystemTime::now() - Duration::from_secs(14 * 24 * 60 * 60);
            let expired = Call::s3("GET", &bucket.path("k"))
                .query_signed(Duration::from_secs(1))
                .at(signed_at);
            // The emulator names its own clock in the error.
            let refused = matches_direct(
                ctx,
                "expired presigned GetObject",
                &expired,
                &["ServerTime"],
            )?;
            assert_eq!(
                refused.engine.status, 403,
                "expired presigned GetObject: status"
            );
            text_contains(
                "expired presigned GetObject",
                &refused.engine,
                "<Code>AccessDenied</Code>",
            );
            text_contains(
                "expired presigned GetObject",
                &refused.engine,
                "Request has expired",
            );
            Ok(())
        },
    );
}

#[test]
fn relay_s3_not_implemented_passes_501() {
    check("engine.relay-s3-not-implemented-passes-501", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let bucket = Bucket::create(&direct, &format!("{}-gap", prefix(ctx, "gap")))?;
        let _engine = start_engine(ctx)?;

        let pair = matches_direct(
            ctx,
            "GetBucketMetadataTableConfiguration",
            &Call::s3("GET", &format!("/{}?metadataTable=", bucket.name)),
            &[],
        )?;
        assert_eq!(
            pair.engine.status, 501,
            "GetBucketMetadataTableConfiguration: status"
        );
        text_contains(
            "GetBucketMetadataTableConfiguration",
            &pair.engine,
            "<Code>NotImplemented</Code>",
        );
        Ok(())
    });
}

#[test]
fn relay_s3_service_error_matches_direct() {
    check("engine.relay-s3-service-error-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let p = prefix(ctx, "err");
        let bucket = Bucket::create(&direct, &format!("{p}-err"))?;
        let _engine = start_engine(ctx)?;

        let absent_key = matches_direct(
            ctx,
            "GetObject of an absent key",
            &Call::s3("GET", &bucket.path("absent")),
            &[],
        )?;
        assert_error_status("GetObject of an absent key", &absent_key);

        let absent_bucket = matches_direct(
            ctx,
            "GetObject in an absent bucket",
            &Call::s3("GET", &format!("/{p}-absent/k")),
            &[],
        )?;
        assert_error_status("GetObject in an absent bucket", &absent_bucket);
        Ok(())
    });
}

#[test]
fn relay_dynamodb_list_tables_matches_direct() {
    check("engine.relay-dynamodb-list-tables-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let p = prefix(ctx, "ddb");
        let table = Table::create(&direct, &format!("{p}-t"))?;
        let _engine = start_engine(ctx)?;

        // No X-Amz-Content-SHA256, as the AWS CLI sends it (evidence §E-I).
        let list = matches_direct(
            ctx,
            "ListTables",
            &Call::json("dynamodb", "DynamoDB_20120810.ListTables", "{}"),
            &[],
        )?;
        assert!(
            list.engine.header("x-amz-crc32").is_some(),
            "ListTables through the engine carries no x-amz-crc32"
        );
        text_contains("ListTables", &list.engine, &format!("\"{}\"", table.name));

        let describe = matches_direct(
            ctx,
            "DescribeTable of an absent table",
            &Call::json(
                "dynamodb",
                "DynamoDB_20120810.DescribeTable",
                &format!(r#"{{"TableName":"{p}-absent"}}"#),
            ),
            &[],
        )?;
        assert_error_status("DescribeTable of an absent table", &describe);
        Ok(())
    });
}

#[test]
fn relay_sqs_queue_url_follow_up_reaches_engine() {
    check(
        "engine.relay-sqs-queue-url-follow-up-reaches-engine",
        |ctx| {
            let ctx: &Ctx = ctx;
            let direct = Direct::new(ctx)?;
            let name = format!("{}-q", prefix(ctx, "sqs"));
            let recorder = CountingListener::start()?;
            let r = format!("http://127.0.0.1:{}", recorder.port);
            let _engine = Engine::start(
                ctx,
                EngineCmd::new(ctx)
                    .env("HTTP_PROXY", r.clone())
                    .env("HTTPS_PROXY", r.clone())
                    .env("ALL_PROXY", r.clone())
                    .env("AWS_ENDPOINT_URL", r.clone()),
            )?;

            let _queue = Queue::track(&direct, &name);
            let created = through_engine(
                ctx,
                "CreateQueue",
                &Call::json(
                    "sqs",
                    "AmazonSQS.CreateQueue",
                    &format!(r#"{{"QueueName":"{name}"}}"#),
                ),
            );
            assert_eq!(
                created.status,
                200,
                "CreateQueue through the engine: status, body {}",
                created.text()
            );
            let looked_up = direct.send(
                "GetQueueUrl",
                &Call::json(
                    "sqs",
                    "AmazonSQS.GetQueueUrl",
                    &format!(r#"{{"QueueName":"{name}"}}"#),
                ),
            )?;
            assert_eq!(
                looked_up.status,
                200,
                "direct GetQueueUrl: {}",
                looked_up.text()
            );
            assert_eq!(
                created.body, looked_up.body,
                "CreateQueue through the engine against GetQueueUrl sent directly: body"
            );

            let body = created.json();
            let url = body["QueueUrl"]
                .as_str()
                .filter(|url| !url.is_empty())
                .expect("CreateQueue must return a nonempty QueueUrl");
            let message = format!("{name}-message");
            let sent = through_engine(
                ctx,
                "SendMessage",
                &Call::json(
                    "sqs",
                    "AmazonSQS.SendMessage",
                    &serde_json::json!({"QueueUrl": url, "MessageBody": message}).to_string(),
                ),
            );
            assert_eq!(
                sent.status,
                200,
                "SendMessage through the engine: status, body {}",
                sent.text()
            );
            let message_id = sent.json()["MessageId"].as_str().map(str::to_owned);
            assert!(
                message_id.as_deref().is_some_and(|id| !id.is_empty()),
                "SendMessage through the engine: no MessageId in {}",
                sent.text()
            );
            let receive = Call::json(
                "sqs",
                "AmazonSQS.ReceiveMessage",
                &serde_json::json!({"QueueUrl": url, "MaxNumberOfMessages": 10}).to_string(),
            );
            let received = wait_for(RECEIVE_BOUND, || {
                let answer = direct.send("ReceiveMessage", &receive).ok()?;
                let body: serde_json::Value = serde_json::from_slice(&answer.body).ok()?;
                body["Messages"]
                    .as_array()?
                    .iter()
                    .find(|m| m["MessageId"].as_str() == message_id.as_deref())
                    .and_then(|m| m["Body"].as_str().map(str::to_owned))
            });
            assert_eq!(
                received.as_deref(),
                Some(message.as_str()),
                "ReceiveMessage sent directly within {} s: the body of the message sent through the engine",
                RECEIVE_BOUND.as_secs()
            );

            assert_eq!(
                recorder.accepted(),
                0,
                "the recording listener on 127.0.0.1:{} (proxy and endpoint variables) accepted connections",
                recorder.port
            );
            Ok(())
        },
    );
}

#[test]
fn relay_iam_list_users_matches_direct() {
    check("engine.relay-iam-list-users-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let p = prefix(ctx, "iam");
        let user = User::create(&direct, &format!("{p}-u"))?;
        let _engine = start_engine(ctx)?;

        let list = matches_direct(
            ctx,
            "ListUsers",
            &Call::query("iam", "Action=ListUsers&Version=2010-05-08"),
            &[],
        )?;
        text_contains(
            "ListUsers",
            &list.engine,
            &format!("<UserName>{}</UserName>", user.name),
        );

        let absent = matches_direct(
            ctx,
            "GetUser of an absent user",
            &Call::query(
                "iam",
                &format!("Action=GetUser&UserName={p}-absent&Version=2010-05-08"),
            ),
            &[],
        )?;
        assert_error_status("GetUser of an absent user", &absent);
        for (side, r) in [("direct", &absent.direct), ("engine", &absent.engine)] {
            assert!(
                r.text().contains("<ErrorResponse"),
                "GetUser of an absent user: the {side} answer is not a query XML ErrorResponse: {}",
                r.text()
            );
        }
        Ok(())
    });
}

#[test]
fn relay_lambda_list_functions_matches_direct() {
    check("engine.relay-lambda-list-functions-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let p = prefix(ctx, "fn");
        let _engine = start_engine(ctx)?;

        matches_direct(
            ctx,
            "ListFunctions",
            &Call::new("lambda", "GET", "/2015-03-31/functions/"),
            &[],
        )?;

        // An encoded ARN in the path: the signature covers each segment encoded again.
        let target = format!(
            "/2015-03-31/functions/arn%3Aaws%3Alambda%3Aus-east-1%3A000000000000%3Afunction%3A{p}-absent/configuration"
        );
        let absent = matches_direct(
            ctx,
            "GetFunctionConfiguration of an absent function",
            &Call::new("lambda", "GET", &target),
            &[],
        )?;
        assert_eq!(
            absent.engine.status, 404,
            "GetFunctionConfiguration of an absent function: status"
        );
        text_contains(
            "GetFunctionConfiguration of an absent function",
            &absent.engine,
            "ResourceNotFoundException",
        );
        Ok(())
    });
}

#[test]
fn relay_unsigned_request_matches_direct() {
    check("engine.relay-unsigned-request-matches-direct", |ctx| {
        let ctx: &Ctx = ctx;
        let direct = Direct::new(ctx)?;
        let p = prefix(ctx, "uns");
        let bucket = Bucket::create(&direct, &format!("{p}-uns"))?;
        bucket.put("k", b"unsigned".to_vec())?;
        let _engine = start_engine(ctx)?;

        let object = matches_direct(
            ctx,
            "unsigned GetObject",
            &Call::s3("GET", &bucket.path("k")).unsigned(),
            &[],
        )?;
        assert_eq!(object.engine.status, 403, "unsigned GetObject: status");
        text_contains(
            "unsigned GetObject",
            &object.engine,
            "<Code>AccessDenied</Code>",
        );

        let form = format!(
            "Action=AssumeRoleWithWebIdentity&Version=2011-06-15\
             &RoleArn=arn%3Aaws%3Aiam%3A%3A000000000000%3Arole%2F{p}-role\
             &RoleSessionName={p}-session&WebIdentityToken=emuforge-check-token"
        );
        matches_direct(
            ctx,
            "unsigned AssumeRoleWithWebIdentity",
            &Call::query("sts", &form).unsigned(),
            &[],
        )?;

        let bearer = matches_direct(
            ctx,
            "GET / with Authorization: Bearer",
            &Call::new("s3", "GET", "/")
                .unsigned()
                .unsigned_header("Authorization", "Bearer abc"),
            &[],
        )?;
        assert_eq!(
            bearer.engine.status, 404,
            "GET / with Authorization: Bearer: status"
        );
        assert_eq!(
            bearer.engine.header("x-amzn-errortype"),
            Some("UnknownService"),
            "GET / with Authorization: Bearer: x-amzn-ErrorType"
        );
        Ok(())
    });
}
