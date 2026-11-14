Issue-Id: 10
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: plan
Issue-Key: engine|browser-relay|missing
Issue-Check-Ids: engine.studio-relay-s3-list-buckets-matches-direct engine.studio-relay-s3-put-object-matches-direct engine.studio-relay-sfn-list-state-machines-matches-direct engine.studio-relay-refuses-without-current-session engine.studio-relay-no-secret-in-output engine.studio-browser-reads-relayed-s3-answer
Issue-Commit: 5d2272d5f0fce6922055a084780221cf8885e7e9

# Relay AWS requests from the Studio origin with its session

> Identified against commit `5d2272d5f0fce6922055a084780221cf8885e7e9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's screens call AWS operations through the engine with the AWS SDK for JavaScript (`studio/AGENTS.md`,
"Talking to AWS": the browser holds no AWS key, the engine identifies the browser by its session and signs
upstream itself). Issue #2 relays signed requests from local tools and refuses any request with an `Origin`
header; issue #7 serves the Studio origin with a session token on the engine's own `/__emuforge/` routes only and
refuses Studio-origin requests on every other path (`.pm/issue-7/requirement.md` §3.3 order 3b, decision D4). So
no Studio screen can reach an AWS operation.

Serving them needs: attributing a Studio-origin request that carries the session token, signing it with the
emulator's key although the browser sent no usable signature, answering the CORS preflight the browser sends for
SDK requests (the emulator answers none), and exposing the response headers the SDK reads (`x-amz-*`,
`x-amzn-*`, `ETag`) to the Studio origin. Reference: the same operation sent straight to aws-emulator signed with
its key, per `engine/references/relay-fidelity.md`.

## Evidence

Emulator 1.0.364 (`.pm/issue-7/evidence/emulator-calls.txt`): a CORS preflight `OPTIONS` from
`http://127.0.0.1:8296` on an S3 object path answers `501 NotImplemented` (section F), on `/__admin/health`
`405` (section B), on `/` `404 UnknownService` (section C); no answer carries an `Access-Control-*` header.
`.pm/issue-2/requirement.md` §2 and §6 order 3: Studio's browser requests are refused with `403 OriginNotAllowed`.

## Steps to Reproduce

1. Build issues #2 and #7; start the engine with `--studio-port 8296` and an emulator.
2. Obtain the token with `GET /__emuforge/session` and `Origin: http://127.0.0.1:8296`.
3. Send `OPTIONS /` with that `Origin` and `Access-Control-Request-Method: GET`, then `GET /` (S3 `ListBuckets`)
   with that `Origin` and `X-EmuForge-Session: <token>`.
4. Both are refused with `403 OriginNotAllowed`.

## Expected

- A CORS preflight from the Studio origin on a relayed path is answered by the engine, listing the methods and
  request headers the SDK sends; from any other origin it is refused.
- A Studio-origin request with the current token on a relayed path is forwarded signed with the emulator's key,
  and its answer equals the same request sent straight to the emulator (relay fidelity), with CORS headers naming
  exactly the Studio origin and the SDK's response headers exposed.
- Without the token, or with a stale one, it is refused and nothing reaches the emulator.
- No emulator key and no session token reaches the browser or a log.

## Out of scope

- IAM identities for the browser (identity switching in Studio).
- Studio screens.
