Issue-Id: 569
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|checks|no-second-run-environment-cases-in-full-only
Issue-Check-Ids:
Issue-Commit: 70c1a2bb3c8c27f5eae46ae54d3398f02444d728

# Take the second runs out, move every environment case to the tier full, and drop the dialog layout check

> Identified against commit `70c1a2bb3c8c27f5eae46ae54d3398f02444d728`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-20: "second run 다 빼버리고 재시작이랑 에뮬레이터 미연결이나 지연 연결 케이스 환경이니까 모두 full로 옮기고
앞으로도 full에서만 진행하게 해. 측정 폭 높이 조합은 스튜디오만인데.. 통테는 빼고 단테에서만 하는게 맞는 것 같은데 단테에 없어서
그래? 만약 없으면 그냥 빼버려. 별로 중요하지 않은거로 자꾸 시간 잡아먹으니.. 어차피 551 실패할테니까 거기에다 바로 반영해".

Of main's 240 browser and product checks (924 s in the full check of 2026-11-20 09:31), 27 take 8 s or more and
make 47% of the time; many of them are cases of the environment, not of a task.

Wanted:

1. **No second run anywhere.** `.github/workflows/main.yml` (and `full.yml` and `.github/ci` where they have it)
   lose every `<step> (second run)` step; `pm-check` no longer runs a failed test step again: a step that fails has
   failed, there is no `flaky` status, and `.pm/run/flakes.jsonl` with the copy of first logs (issue 542) is no longer
   written (the files already there stay). `pm-merge`, the `pm`'s SKILL ("Intermittent failures", the flake of a run
   on GitHub Actions), `lead.md`, `tests/integration/AGENTS.md` and root `AGENTS.md` follow where they name a second
   run or a flake.
2. **Environment cases run in the tier `full` only.** Every check whose scenario is the emulator or the engine
   stopped, restarted, not there, not reachable, or coming up late gets the label `full`: the restart checks of the
   services (`studio.dynamodb-emulator-restart-shows-the-empty-emulator`, `studio.sns-screens-follow-an-emulator-restart`,
   `studio.sqs-emulator-restart-shows-the-empty-emulator`, `studio.s3-objects-follow-emulator-restart`,
   `studio.s3-object-page-follows-emulator-restart`), `studio.aws-area-emulator-line-follows-emulator-stop-and-start`,
   `studio.home-shows-engine-unreachable-and-recovers`, `engine.product-start-says-when-the-emulator-did-not-come-up`,
   `engine.product-connects-when-the-emulator-starts-later`, and every other check of that kind the engineer finds
   in the manifests (the engine's reconnect and restart checks, a session renewed after an engine restart, a target
   tested across a restart, …): the plan lists each with its seconds and the `pm` judges the list.
   `tests/integration/AGENTS.md` (the tier `full`), `studio/references/test-criteria.md`,
   `engine/references/test-criteria.md` and `lead.md` say that such a case is written for the tier `full` and never
   for the push run or a whole check, so a new service's plan does not bring one back.
3. **The dialog layout check goes.** `studio.aws-area-dialog-is-above-studio-bar` (27.9 s; it measures the dialog
   against Studio's bar at several widths and heights) is removed with its support file and manifest row: jsdom
   cannot measure layout, so no unit test holds it, and the owner drops it rather than keep it in the browser
   checks. Issue 531's closed file keeps its id as history.

The engineer changes files under `tests/integration/` and `.github/` for this on the owner's word. No test is
added. It is merged at once, whatever the state of main's run.

## Evidence

`output/logs/check-integration.log` of the main checkout (2026-11-20 09:31): the durations by check.

## Steps to Reproduce

Read `.github/workflows/main.yml` for `second run`; the manifests for the checks above without the label `full`.

## Expected

A failure fails at once; the push run and a whole check hold no environment case; the integration step is shorter by the moved and removed checks.

## Out of scope
