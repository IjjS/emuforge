Issue-Id: 445
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: gap
Issue-Source: finder
Issue-Key: studio|aws-area|shared-request-states
Issue-Check-Ids:
Issue-Commit: 8accb905bed54bd6e4e266c14fc562b0755591a8

# Give the AWS area one mapping of a failed request to a screen's states, before a third service copies it

> Identified against commit `8accb905bed54bd6e4e266c14fc562b0755591a8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Every service's data layer needs the same two things: the mapping of a failed SDK request to the states an area
screen shows (501 "not implemented", `AccessDenied`, the engine's `EmulatorUnavailable` and `EmulatorTimeout`, no
answer from the engine, any other code or status line), and the wait that ends a request at once when its signal
aborts. `studio/AGENTS.md` says what two services share moves to `providers/aws/area/components/` or `lib/`,
and a service folder may not import another's (lint, issue 386).

Today the two are written in the S3 folder (issue 56). Issue 84's unit `s1` wrote them again in the Lambda
folder and filed this as issue 444 (LOW, on `feat/84`, not on `main` yet); issue 82's `s1` (IAM) wrote its own
at the same time. Nine more planned services (issues 69 to 79, 73, 245, 282) would each copy them. The Lambda
copy also names the operation in each failure and reads the query protocol's `Code`, which the S3 copy does not.

Scope, so that nothing in flight is touched: the shared module is made from the S3 folder's code and S3 uses
it; it covers what the Lambda and IAM copies need (the operation's name, the query protocol's `Code`), read
from their branches. The copies in the Lambda and IAM folders are replaced in an issue of their own once issues
82 and 84 are on `main`; say so and file it. Later service issues use the shared module from the start.

## Evidence

`studio/src/providers/aws/area/services/s3/` on `main`; `feat/84-s1` and `feat/82-s1` (the Lambda and IAM
folders' `api.ts`); the issue file of 444 on `feat/84-s1`.

## Steps to Reproduce

1. Compare the failure mapping of the three folders.

## Expected

- One module of the area holds the mapping and the abortable wait, with its unit cases; S3 uses it and its
  checks pass unchanged.
- `studio/AGENTS.md` names it where it says how a service talks to AWS, so a new service's data layer starts
  from it.
- No screen shows anything different.

## Out of scope

- The Lambda and IAM folders (their own issue after 82 and 84).
