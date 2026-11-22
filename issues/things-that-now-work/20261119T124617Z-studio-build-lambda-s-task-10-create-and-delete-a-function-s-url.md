Issue-Id: 527
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.function-url|task
Issue-Check-Ids: studio.lambda-function-url-create,studio.lambda-function-url-delete,studio.lambda-function-url-create-conflict,studio.lambda-function-url-delete-missing
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 10: create and delete a function's URL

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 10: a developer gives a function a URL and removes it. Studio shows a function's URL when it has one (the
"Function overview" of `main`, with its copy control) and cannot create or delete one. The reference is the same
request sent straight to aws-emulator: `CreateFunctionUrlConfig`, `GetFunctionUrlConfig`, `DeleteFunctionUrlConfig`.
Part of what issue 346 left (its configuration tab beyond the general configuration and the environment variables).

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## function URL": the three operations answered; the URL is on another port of the emulator's own,
  of the form `https://127.0.0.1:<port>/_aws/lambda-url/{id}/`.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. The page shows no way to create a URL for the function; a function with one shows no way to delete it.

## Expected

- A developer creates a function's URL and the page shows it with its copy control.
- A developer deletes the URL and the page shows none.
- Refusals of the emulator are reported with its code.
- Each proven by a scenario against the real emulator.

## Out of scope

Calling the URL from Studio (it is on a port of the emulator the engine does not relay; whether Studio may is a decision of this task's requirement), CORS settings, the auth type beyond what the emulator needs.
