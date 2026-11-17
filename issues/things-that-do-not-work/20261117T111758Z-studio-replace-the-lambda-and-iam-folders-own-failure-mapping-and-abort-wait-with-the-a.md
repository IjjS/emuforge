Issue-Id: 459
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.lambda-iam-data-layers|own-copy-of-request-states
Issue-Check-Ids:
Issue-Commit: 5df2a35d79626da430c2392adf6d858f6c964408

# Replace the Lambda and IAM folders' own failure mapping and abort wait with the area's shared one

> Identified against commit `5df2a35d79626da430c2392adf6d858f6c964408`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/AGENTS.md` says what two AWS services share moves to `providers/aws/area/components/` or `lib/`. Issue
445 makes the area's one mapping of a failed request to a screen's states, and the wait that ends a request at
once when its signal aborts, and moves the S3 folder onto it. Issues 82 (IAM) and 84 (Lambda) were in flight at
the time, each with a copy of both in its own `api.ts`; issue 445 touched neither folder. This issue replaces the
two copies once both folders are on `main`.

Issue 444 (LOW, filed by issue 84's unit `s1` on `feat/84`) asks for the same sharing between the S3 and the
Lambda folders. Which is which: issue 445 does issue 444's shared module and its S3 half; this issue does issue
444's Lambda half and the IAM folder, which issue 444 does not name. When issue 444's file reaches `main` it is
closed with this one, by the same checks.

The copies differ from the shared mapping in three places, and each difference is settled here, not carried over
silently:

- The IAM copy cuts a trailing `Exception` from every code (`codeOf`). The shared mapping shows a code as the
  answer wrote it. For the query protocol the answer's code is in `Code` (`NoSuchEntity`), which has no such
  suffix, so the IAM screens' codes do not change for an answer of the emulator; the engine's own codes have none
  either.
- Both copies take the SDK's `name` as the code when the rejection has no `Code`, whatever the rejection is. An
  answer the SDK could not read (a body that is not the protocol's) is rejected as a plain `Error` or
  `SyntaxError`, so the Lambda and IAM screens show "SyntaxError" or "Error" with the SDK's parse message as if
  the emulator had answered that code. The shared mapping shows such an answer as its status line.
- The Lambda copy has `sent` (a request whose rejection is not mapped) and `isNotFound`, used to tell "the
  function has no URL" and "not found" before mapping. With the shared mapping the same is read from the mapped
  failure (`other` with the code `ResourceNotFoundException`; `not-implemented`).

## Evidence

- `studio/src/providers/aws/area/services/lambda/api.ts` at `feat/84-s1` (`7cae936`): `LambdaFailure`,
  `LambdaRequestError`, `failureOf` (line 210), `untilAborted` (line 249), `sent`, `request`.
- `studio/src/providers/aws/area/services/iam/api.ts` at `feat/82-s1` (`2016157`): `IamFailure`, `IamError`,
  `codeOf`, `failureOf` (line 217), `untilAborted` (line 256), `request`.
- `studio/src/providers/aws/area/services/s3/api.ts` at `5df2a35`: `readFailure` (line 91), `untilAborted`
  (line 125): the same rows of the same table, three times.
- What the SDK rejects with for an answer it cannot read: `.pm/issue-445/probe/probe-3.log`, for example
  `LambdaClient (REST JSON) | 409, a body that is neither XML nor JSON | {"class":"SyntaxError","name":"SyntaxError","status":409,…,"message":"JSON Parse error: Unexpected identifier \"not\"…"}`
  and `IAMClient (query) | 409, … | {"class":"Error","name":"Error","status":409,…,"message":"@aws-sdk XML parse error: unexpected content.…"}`.

## Steps to Reproduce

1. With issues 82, 84 and 445 on `main`:
   `grep -n "function untilAborted" studio/src/providers/aws/area/services/*/api.ts` finds two definitions, in
   the Lambda and the IAM folders.
2. Answer `ListFunctions` with status 409 and the body `not json`: the function list's error names the code
   "SyntaxError".

## Expected

- The Lambda and the IAM data layers use the area's shared mapping and abort wait; neither folder defines its
  own.
- Every state of the Lambda and IAM screens for a failed request reads as before for an answer that has a code,
  and an answer the SDK cannot read is shown with its status line, not with "SyntaxError" or "Error".
- The flow checks of both services pass unchanged.

## Out of scope

- The words each screen shows for a state.
- The S3 folder and the shared module (issue 445).
