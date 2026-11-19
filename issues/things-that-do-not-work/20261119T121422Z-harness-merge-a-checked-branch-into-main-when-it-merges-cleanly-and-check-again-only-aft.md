Issue-Id: 520
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|pm-merge|merge-on-a-clean-merge-like-a-pull-request
Issue-Check-Ids:
Issue-Commit: d0ac9aed12be15fb14aefe52128bdebe73322a6c

# Merge a checked branch into main when it merges cleanly, and check again only after a conflict

> Identified against commit `d0ac9aed12be15fb14aefe52128bdebe73322a6c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19: "PR이랑 비슷한 로직이면 되잖아. 모음 브랜치에서 전체 검사 -> fast-forward 되면 머지 / 안되면
plan이 합쳐서 conflict 고치게 한 다음에 다시 돌리고 머지 -> CI에서 알아서 최종 검사."

Today `pm-merge` takes a branch only when its last `pm-check` record is a pass on the commit being merged and covers
what the branch changes against `main` as it is: once `main` has moved in paths that call for the same checks, the
branch must take `main` and run its whole check again, conflict or not. On 2026-11-19 that happened five times
(issues 494, 496, 503 twice, 509, and 510), 15 to 20 minutes each on a machine at 100% CPU; all five second runs
passed, so they found nothing.

Wanted, as a pull request is merged:

1. A branch (an issue's collecting branch `feat/<id>`, or a harness issue's unit branch) whose last record is a
   pass on its head is merged into `main` when git merges it with no conflict (a fast-forward or a clean merge
   commit), whatever `main` gained meanwhile. No second check.
2. When git reports a conflict, nothing is merged: the lead (`plan`, or the harness-engineer) merges `main` into
   its branch (`pm-merge <id> --take-main` for a plan), has the conflict resolved by the unit that owns the files,
   runs the whole check again, and then 1 applies.
3. The record must still be a pass on the branch's head: a branch changed after its check is checked again, and a
   merge commit that took `main` with a conflict resolved is such a change.
4. The run of `.github/workflows/main.yml` on the push is the check of the merged result. When that run fails right
   after such a merge, the `pm` files it and starts it at once, ahead of the queue, without waiting for the owner's
   signal (a red `main` holds every other merge); this is the one exception to "an issue filed from a run waits".
   (The `pm`'s addition to the owner's words; the owner may strike it.)

Everything that states the old rule follows: `pm-merge` and its tests, root `AGENTS.md` (Branches and main), the
`pm`'s SKILL (merge, the run on GitHub Actions), `lead.md` (Close, `--take-main`), the harness-engineer brief, and the
unit merges into a collecting branch only if they share the code path (they are not asked to change).

## Evidence

`.pm/run/events.log` and the reports of issues 494, 496, 503 (2026-11-19): five refused merges, five second whole checks, all passed.

## Steps to Reproduce

Finish two issues at about the same time; merge one; `pm-merge` the other.

## Expected

The second merges at once when git finds no conflict.

## Out of scope
