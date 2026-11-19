Issue-Id: 542
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|flakes|first-log-lost-with-the-worktree
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 30cadce92c94e015e8fb6093855a97eeddfd8103

# Keep the first log of a flaky step when its worktree is removed

> Identified against commit `30cadce92c94e015e8fb6093855a97eeddfd8103`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check` records a flaky step in `.pm/run/flakes.jsonl` with the path of the first run's log, which lies in the
worktree (`<worktree>/output/logs/check-<step>.attempt1.log`). `pm-archive` removes the worktree, and the log with it:
the line then points at nothing. Twice on 2026-11-19 the `pm` merged and archived before reading it (issue 496, an
`engine-test` flake; issue 540, an `integration` flake of 1 999 s), so neither flake could be traced or filed with
its evidence. A harness-engineer's `output/report.md` is lost the same way.

Wanted: when `pm-check` records a flake it copies the first log to `.pm/run/flakes/<stamp>-<issue or checkout>-<step>.log`
and writes that path in the line; and `pm-archive` copies a unit's `output/report.md` into `.pm/archive/<id>/` before
the worktree goes. No test is added (issue 523).

## Evidence

`.pm/run/flakes.jsonl`, the lines of 2026-11-19T18:37 and 2026-11-20T00:14: their `first_log` paths no longer exist.

## Steps to Reproduce

A flaky step in a worktree; `pm-merge`, `pm-archive`; open the line's `first_log`.

## Expected

The first log of every recorded flake can be read after the worktree is gone.

## Out of scope
