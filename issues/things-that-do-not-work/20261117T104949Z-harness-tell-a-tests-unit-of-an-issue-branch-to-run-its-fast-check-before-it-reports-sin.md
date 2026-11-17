Issue-Id: 443
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|brief-worker|tests-unit-fast-check
Issue-Check-Ids:
Issue-Commit: b34d88f5e321018d97e5324f302cc613b6e4f9df

# Tell a tests unit of an issue branch to run its fast check before it reports, since pm-merge takes it only with that record

> Identified against commit `b34d88f5e321018d97e5324f302cc613b6e4f9df`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Since issue 63 a `t` unit of an issue branch is merged into the issue branch on its checks review, red or not,
and `pm-merge <id> <unit>` takes a unit only when its worktree has a `pm-check` record that passes on the
commit (the fast check, which leaves `integration` to the issue branch). The worker brief
(`.agents/skills/pm/references/briefs/worker.md`) tells a tests unit to run its checks with
`pm-check <worktree> --checks <id>…`, whose record is never a gate, and does not tell it to run `pm-check`
itself; only the implementing unit's part does.

Seen on 2026-11-17 with issue 82: `t2` was reviewed and passed, and `pm-merge 82 t2` answered
`no pm-check run recorded for this worktree`. Issue 82's `t1` had run it unasked and merged. Every service
issue has three tests units.

## Evidence

`.agents/skills/pm/references/briefs/worker.md` lines 26 and 42 on `main` at `495a18d`; `.pm/run/events.log` of
2026-11-17 around 20:20 (issue 82, `t2`).

## Steps to Reproduce

1. Run a tests unit of an issue that has an issue branch as its brief says; get `rev`'s pass.
2. `pm-merge <id> <unit>`: refused for want of a record.

## Expected

- The brief of a tests unit of an issue branch says to run the fast check before `UNIT READY`, and what it means
  that its new checks are red there by design (the fast check does not run them).
- `pm-merge`'s refusal says what to run.
- A harness test holds the brief's sentence.

## Out of scope

- Whether a tests unit should need a record at all.
