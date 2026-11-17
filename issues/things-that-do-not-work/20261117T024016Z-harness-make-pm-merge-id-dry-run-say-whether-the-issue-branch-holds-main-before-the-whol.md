Issue-Id: 343
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-merge-issue-dry-run|behind-main-before-whole-check
Issue-Check-Ids:
Issue-Commit: 753163221f52536658656b73cae9b7a40ec31f66

# Make pm-merge <id> --dry-run say whether the issue branch holds main before the whole check

> Identified against commit `753163221f52536658656b73cae9b7a40ec31f66`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The PM's flow (issue 63) needs to know, when the last unit of an issue is merged into its issue branch, whether
the issue branch must take `main` before the whole check. Issue 63's design says `pm-merge <id> --dry-run` answers
that (its refusal list holds the behind line). It does not: before the whole check the issue's worktree has no
`last.json` of the issue branch's head, and the issue form stops at the record's problems without asking whether
`main` moved. The behind question is asked only once a passing record of the head exists, which is after the whole
check it was meant to come before. The PM skill now sends the PM to `pm-merge <id> --take-main` at that point
instead, which answers by itself (`feat/<id> already holds main`), so nothing is blocked; the dry run still does
less than its design says.

Found by `rev` at issue 63's review of unit `h2` (`review-impl-h2-r1.md`, P2), in code unit `h1` merged.

## Evidence

- `.pm/bin/pm-merge` at `7531632`, `into_main_whole`: `found = record_problems(last, head)`; `judge(...)`, the
  only call that prints the behind line, runs only `if not found`.
- `.pm/issue-63/design.md`, section 2.4: "So `pm-merge <id> --dry-run` is how the `pm` learns that `--take-main`
  is needed: its list then holds the behind line of section 3."

## Steps to Reproduce

1. On a fixture, `pm-worktree new 9`, a unit merged into `feat/9`, then a commit on `main` that touches a path the
   issue branch's paths call for.
2. `pm-merge 9 --dry-run` before any `pm-check` of the issue's worktree: the refusal names the missing record only;
   no line says `feat/9` is behind `main`.

## Expected

- `pm-merge <id> --dry-run` names, among its reasons, that the issue branch does not hold `main` (the modules and
  one gained path each), whether or not the issue's worktree holds a record of the head.

## Out of scope

- The other conditions of `pm-merge <id>` and the forms with a unit; `--take-main` itself.
