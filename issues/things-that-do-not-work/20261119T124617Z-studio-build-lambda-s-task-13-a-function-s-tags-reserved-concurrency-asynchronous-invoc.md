Issue-Id: 530
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.tags-concurrency-async-role|task
Issue-Check-Ids:
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 13: a function's tags, reserved concurrency, asynchronous invocation settings and execution role

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 13: the settings of a function a developer changes less often: its tags, its reserved concurrency, its
asynchronous invocation settings, and another execution role or architecture. "Configuration" (issue 516) changes the
handler, runtime, memory, timeout, description and environment variables only. The reference is the same request sent
straight to aws-emulator: `TagResource`, `ListTags`, `UntagResource`, `PutFunctionConcurrency`,
`PutFunctionEventInvokeConfig`, `UpdateFunctionConfiguration` with `Role`. Part of what issue 346 left.

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## tags, concurrency, event invoke config": each operation answered and was read back; with reserved
  concurrency 0 `Invoke` answers 429 `TooManyRequestsException` "Rate Exceeded.".

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. "Configuration" shows the execution role as text only, and nothing of tags, concurrency or asynchronous invocation.

## Expected

- A developer adds and removes a function's tags.
- A developer sets and removes the reserved concurrency; an invocation refused for it says why.
- A developer changes the retries and the event age of asynchronous invocation.
- A developer gives the function another execution role.
- Each proven by a scenario against the real emulator.

## Out of scope

Provisioned concurrency, destinations, VPC, file systems, the console's other configuration sections the emulator has no use for.
