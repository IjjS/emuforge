Issue-Id: 13
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-client-factory|no-scope-no-session
Issue-Check-Ids: studio.aws-clients-list-matches-direct studio.aws-clients-renew-session-after-engine-restart
Issue-Commit: ac5eaf37236757711779063bc2b4c75738773d88

# Send Studio's AWS requests in SigV4 form with the session token

> Identified against commit `ac5eaf37236757711779063bc2b4c75738773d88`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's AWS client factory (`studio/src/lib/aws/client-factory.ts`) builds every S3 and Step Functions client with
the `smithy.api#noAuth` scheme, so each request leaves with no `Authorization`, no `X-Amz-Date` and no credential
scope, and without the `X-EmuForge-Session` header. The engine identifies a browser request by that header (issue
#7) and, for relayed AWS requests, takes the region, service and date it signs with from the request's own SigV4
form; it never derives a service from a request (issue #10, `.pm/issue-10/requirement.md`, provisional D1). The
emulator routes a request by its credential scope, `X-Amz-Target` or `Host`, and cannot route Studio's unsigned
requests at all. The reference: the same operation sent straight to aws-emulator, signed with its key, answers.

## Evidence

`.pm/issue-10/evidence/emulator-calls.txt` (emulator 1.0.364, commit 7496e0f):

- §S.1: the factory's `ListBuckets`, `PutObject`, `GetObject` and `ListStateMachines` carry no `Authorization`, no
  `X-Amz-Date` and no `X-Emuforge-Session` header.
- §D A1, A2: the same requests sent straight to the emulator answer `404 UnknownService` ("could not resolve a target
  service from the request", "no emulated service is registered for 'awsstepfunctions'"); A3: `ListStateMachines`
  signed for service `states` answers `200`.
- §E E9: through the engine on `main` the unsigned `ListStateMachines` answers the same `404 UnknownService`.
- §S.2: the same clients with SigV4 and a fixed placeholder credential send `Authorization` with scope
  `<date>/us-east-1/s3/aws4_request` and `.../states/aws4_request`, which the engine re-signs with the emulator's key
  (§E E6, E8: `200` from a local tool).

## Steps to Reproduce

1. Start an emulator on a free port and the engine from `main` with `--emulator-port <port>`.
2. Create an `SFNClient` with `createSfnClient({ endpoint: 'http://127.0.0.1:<engine port>' })` and send
   `ListStateMachines` from a script (no browser, so no `Origin`).
3. The answer is `404 UnknownService`.

## Expected

- Every AWS SDK request Studio sends carries a well-formed SigV4 `Authorization` header (header form), signed with a
  fixed credential that is not an AWS key and is not secret, for region `us-east-1` and the service's own signing
  name; no credential is read from the environment, a file or browser storage.
- Every such request carries `X-EmuForge-Session: <token>` with the token Studio holds from `GET /__emuforge/session`.
- An SDK request answered `401` with code `SessionInvalid` or `SessionRequired` fetches the session once and is
  retried once, as Studio already does for health.
- Sent through the engine with issue #10 built, `ListBuckets` and `ListStateMachines` from the built Studio answer the
  same as the same operation sent straight to the emulator signed with its key.

## Out of scope

- The engine side: answering the CORS preflight, removing browser headers, re-signing (issue #10).
- Studio screens that use these clients.
