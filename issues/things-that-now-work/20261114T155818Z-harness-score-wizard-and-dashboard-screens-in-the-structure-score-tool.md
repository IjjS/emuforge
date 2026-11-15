Issue-Id: 8
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|structure-score|wizard-dashboard-specs
Issue-Check-Ids: harness.spec harness.score harness.records harness.capture harness.docs
Issue-Commit: b6826962168941938001393417fa6f23f2acc5ce

# Score wizard and dashboard screens in the structure score tool

> Identified against commit `b6826962168941938001393417fa6f23f2acc5ce`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/references/console-reference.md` defines reference specs for `wizard` screens (`steps`, each with
`sections`) and names a `dashboard` kind, and its structure score opens the spec's route once and reads one
accessibility tree. A wizard's steps after the first are reached only by interaction, and the `dashboard` blocks
are not defined in the format. The structure score tool of issue #4 (`pm-structure`) therefore refuses
`kind: wizard`, `kind: dashboard` and a `steps` block with exit status 2 ("is not supported"), so a console screen
of either kind cannot be scored. The reference is the method in `console-reference.md`, which counts each step
as an item.

## Evidence

`.pm/issue-4/requirement.md` (issue #4, requirement passed by rev in round 2), section 6 and section 9 item 2:
`kind: wizard` or `kind: dashboard`, a `steps` block → `spec <path>: <what> is not supported`.
`console-reference.md`, "Format": "`steps` (each with `sections`) for `wizard`"; the `dashboard` kind has no block
defined.

## Steps to Reproduce

1. Once issue #4 is merged, write a spec with `kind: wizard` and a `steps` list.
2. Run `pm-structure <worktree> <spec> --snapshot <any snapshot>`: it exits 2 with "is not supported".

## Expected

- A `wizard` spec is scored: each step title is an item, the steps' order is an item, and the sections of every
  step are reached and scored by a defined, repeatable way of moving through the steps.
- The `dashboard` kind has its blocks defined in `console-reference.md` and is scored by them, or is removed from
  the format.
- The same spec and the same screen always give the same score.

## Out of scope

- Every kind issue #4 already scores (`table`, `detail`, `form`).
- Writing specs for real wizard or dashboard screens.
