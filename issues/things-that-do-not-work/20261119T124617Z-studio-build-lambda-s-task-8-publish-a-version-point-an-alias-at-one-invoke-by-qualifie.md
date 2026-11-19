Issue-Id: 525
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.versions-and-aliases|task
Issue-Check-Ids:
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 8: publish a version, point an alias at one, invoke by qualifier

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 8: a developer publishes a version of a function, points an alias at a version, and invokes a version or an
alias. Studio has no screen for versions or aliases (issue 516 removed the tabs "Aliases" and "Versions" of `main`,
which led to "no screen yet"), and "Test" invokes `$LATEST` only. The reference is the same request sent straight to
aws-emulator: `PublishVersion`, `ListVersionsByFunction`, `CreateAlias`, `UpdateAlias`, `ListAliases`, `DeleteAlias`,
`Invoke` with `Qualifier`. This task takes the place of issue 347.

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## versions and aliases": each of the operations above answered; `Invoke` with a qualifier ran the
  code of that version, and an alias moved to another version ran the other code.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. No tab or control publishes a version, lists versions or aliases, or invokes one.

## Expected

- A developer publishes a version and sees it in the function's versions.
- A developer creates an alias for a version, points it at another version and deletes it.
- A developer invokes a version or an alias on "Test" and the result is that version's.
- Refusals of the emulator are reported with its code.
- Each proven by a scenario against the real emulator.

## Out of scope

Weighted aliases (routing configuration), provisioned concurrency.
