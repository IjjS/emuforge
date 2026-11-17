Issue-Id: 444
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|aws-area.request-failure-mapping|duplicated-across-services
Issue-Check-Ids:
Issue-Commit: b15ce0d26ce90495511c8438cab25e79cf0be0be

# Share the AWS area's mapping of a failed request to its state between services

> Identified against commit `b15ce0d26ce90495511c8438cab25e79cf0be0be`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/AGENTS.md` ("Stack and structure") says what two AWS services share moves to
`providers/aws/area/components/` or `lib/`. The mapping of a failed SDK request to the states of an area screen
(501 "not implemented", `AccessDenied`, the engine's `EmulatorUnavailable` and `EmulatorTimeout`, no answer from the
engine, any other code or status line) and the wait that ends a request at once when its signal aborts are written
twice: once in the S3 folder (issue 56) and once in the Lambda folder (issue 84, unit `s1`), which may not import from
each other. Every later service's data layer would copy them a third time. The Lambda copy also names the operation in
each failure and reads the query protocol's `Code`, which the S3 copy does not need.

## Evidence

- `studio/src/providers/aws/area/services/s3/api.ts`: `readFailure` (line 91) and `untilAborted` (line 125).
- `studio/src/providers/aws/area/services/lambda/api.ts`: `failureOf` (line 210) and `untilAborted` (line 249), at
  commit `b15ce0d26`.

## Steps to Reproduce

1. `grep -n "function untilAborted" studio/src/providers/aws/area/services/*/api.ts`: two definitions.
2. Compare `readFailure` of the S3 folder with `failureOf` of the Lambda folder: the same rows of the state table.

## Expected

- One mapping of a failed request to its kind and one abort wait, in `providers/aws/area/components/` or `lib/`,
  used by the S3 and the Lambda data layers.
- The unit cases of both folders' `api.test.ts` pass unchanged.

## Out of scope

The words each screen shows for a state, and any change of a state's rule.
