Issue-Id: 497
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|events|every-turn-ends-with-a-typed-line-no-ready
Issue-Check-Ids: harness.turn-end harness.pane-reset harness.orphan-event harness.check-room harness.lead
Issue-Commit: a294e7867fb0adfd02ae94d1078ebbc6410e9403

# End every pane's turn with a typed line and act on a turn that ends without one; drop READY; make the room and orphan checks event-driven

> Identified against commit `a294e7867fb0adfd02ae94d1078ebbc6410e9403`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19, after two panes stopped silently (`i480-plan` waiting on a merge Claude Code refused,
`i480-worker-s3` whose turn ended mid-unit at 10:03 and sat for an hour) and the `pm` proposed a 30-minute timer:
"가능하면 백그라운드 폴링을 최소화하고싶은데", "ready는 아예 없애버리는게 좋을 것 같아. 이슈 수집은 내가 직접하는게 맞을 듯",
"조용히 멈춘 패널은 report에 그 유형을 보고 이벤트 수집 시 판단하는 절차를 조정해야될 것 같아 … 무시해도 되는 event랑 후속 작업이
필요한 event가 정해져야될 것 같은거지. event는 모두 구독이나 인터럽트가 맞긴 한 것 같아서." CPU measuring stays as it is (the
owner holds it).

Wanted:
1. **Every turn of a pane ends with a typed report line.** Today a turn may end with none, and `pm-watchd` logs such a turn and never
   delivers it (PM skill, Events). Types: today's `STAGE READY`, `UNIT READY`, `ISSUE READY`, `DONE`, `BLOCKED …`, `REVIEWED`, and new
   ones for a pane that waits on purpose (`WAITING <what>`: a check's result, another unit, a review) or has a run going in the
   background that will report. A table in one guide gives each type its handling: logged only, or delivered to the pane's lead (the
   issue's plan, or the `pm`) with what the lead does.
2. **A turn that ends with no report line is itself an event** (`EVENT silent <pane>`), delivered at once to the lead, from herdr's
   event that the agent's turn ended; no timer. The lead looks at the pane's state and tells it to go on or to report.
3. **READY goes.** `pm-ready` (poll, list, take, schedule), its launchd job, its tests, `EVENT go github#<n>` and the go signal by a
   `READY` comment in root `AGENTS.md` and the PM skill are removed: work from outside starts only on the owner's direct word; the owner
   collects issues. Issue files whose `Issue-Source` is `github#<n>` keep their text.
4. **The room and orphan checks become event-driven.** `EVENT room` is judged when a check ends or a pane closes (the events that free
   room), not every 30 s; the orphans of a worktree are looked for when a pane of that worktree ends a turn or is closed, not on every
   wake-up. CPU and memory keep the daemon's timer.
5. Issue 495 (filed on `feat/486`, reaching `main` with issue 486): `pm-pane reset`'s marker is read when it wraps in a narrow pane.
   Done here; 495 is closed by this issue's closing commit when its file is on `main`, else by the `pm` after.
6. The issue files of issues already merged that stayed open are closed here with their check ids: 477, 478, 482, 483 (harness) and 485
   (engine).
7. The PM skill says `gh run watch <id> --interval 60` (the `pm` reads a run once a minute, not every 3 s).

## Evidence

`.pm/run/events.log`: `turn-end i480-worker-s3 (no report line)` at 10:03 and the hour after; `.pm/issue-480/state-plan.md` (the refused merges). The owner's words above.

## Steps to Reproduce

A pane whose turn ends with no report line: nothing reaches its lead.

## Expected

No pane can stop silently: its lead hears of it the moment its turn ends without a typed line. No READY machinery. No 30-second polling for room or orphans.

## Out of scope
