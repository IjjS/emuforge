Issue-Id: 572
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|pm-merge|round-gap-check-takes-critique-files-for-review-rounds
Issue-Check-Ids:
Issue-Commit: 53b7b955cbf9a1a93dcdf2d2f1381431d8e5030a

# pm-merge's round check refuses an issue for its critique files

> Identified against commit `53b7b955cbf9a1a93dcdf2d2f1381431d8e5030a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-merge 553` refused a finished issue: "review-final: r1 missing of r1..r4; a review round is answered by the next
round, never run again in place of being answered". The files it read are the critique's, not `rev`'s:
`review-final.md`, `review-final-r2.md`, `review-final-r3.md`, `review-final-r4.md` (the critique's first `final`
carries no `-r1`). The round check of issue 557 takes every `review-<stage>-r<k>.md` for a review round of `rev`.

Wanted: the round check looks only at the stages of `review-protocol.md` (`requirement`, `plan-set`, `impl`, and
`impl-<unit>` where a unit's review exists); a critique's `review-final*.md` is not a review round and is never
counted. No test is added (issue 523); the engineer runs `pm-merge 553 --dry-run` once from its worktree's copy
against the main checkout's `.pm/issue-553/` and gives its answer.

## Evidence

`pm-merge 553 --dry-run` on 2026-11-20; `.pm/issue-553/` (the four `review-final*.md`).

## Steps to Reproduce

`pm-merge <id> --dry-run` for an issue whose critique ran more than once.

## Expected

The merge is not refused for the critique's files.

## Out of scope
