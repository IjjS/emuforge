Issue-Id: 528
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.resource-policy|task
Issue-Check-Ids:
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 11: see and change who may invoke a function

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 11: a developer sees who may invoke a function and adds or removes a statement of its resource policy. Studio has
no screen for it. The reference is the same request sent straight to aws-emulator: `GetPolicy`, `AddPermission`,
`RemovePermission`. Part of what issue 346 left.

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## permissions": `AddPermission` added a statement, `GetPolicy` returned the policy with it,
  `RemovePermission` removed it.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. No screen shows the function's resource policy.

## Expected

- A developer reads the statements of a function's resource policy; a function without a policy says so.
- A developer adds a statement (principal, action, optional source ARN) and removes one.
- Refusals of the emulator are reported with its code.
- Each proven by a scenario against the real emulator.

## Out of scope

Editing the policy as JSON; the execution role's own policies (IAM's screens).
