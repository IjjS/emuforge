Issue-Id: 523
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|tests|remove-the-harness-tests-but-the-guards-against-harm
Issue-Check-Ids: harness.guards
Issue-Commit: 0d432947131b7900945c116b072b568c4e218b68

# Remove the harness tests but the few that guard the machine's disk, memory and CPU, and write none from now on

> Identified against commit `0d432947131b7900945c116b072b568c4e218b68`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19: "앞으로 하네스 추가할 때 테스트 넣지마. 하네스 검증 필요한 건 딱 디스크나 메모리, CPU에 유해할 수
있는 것만 해. 1번, 2번은 일단 다 하지마. 지워버려. 포트 겹치는건 자동으로 2단계 씩 늘어나는 로직 넣어두면 괜찮을거 아냐? …
테스트 선택적으로 하는걸 테스트하는거야? 그런거면 3번도 없애도 되잖아. 아니 그냥 다 없어도 될 것 같은데? … 뭐 프로그램 로직도
아닌데 이게 말이 안되는 것 같다."

The harness (`.pm/bin`, about 8 600 lines) carries 49 test files, 1 167 cases and 22 000 lines; its test step takes a
median of 880 s (up to 2 007 s) on every change of a harness file or a guide, fails on a busy machine
(`test_compose_side_by_side`, four times on 2026-11-19), and holds rule changes up through tests that read the
guides for words. It did not catch the three real faults of that day (issues 504, 509, 510), whose stand-ins did
not behave as herdr does.

Wanted:

1. The harness tests are removed, all but those that keep a script from harming the machine: what a script may
   delete, stop or prune (a folder under `~/.aws/emulator/` that is not its own, the owner's port 9297, the machine's
   image `aws-emulator`, a container, volume or image of another run or another project, a process that is not an
   orphan of that worktree, Docker's caches beyond the one prune), and the limits that keep panes and checks from
   exhausting memory and CPU (`pm-mem`, the room for a pane and for a check). The engineer's plan lists every test
   file with `keep` or `remove` and one reason, and the kept cases file by file; the `pm` judges the list. Kept
   cases use no real Docker, no real herdr and no sleep, and together run in seconds.
2. Removed outright, whatever they guard: every test that reads a guide, a brief, a docstring or a workflow file
   for words (the owner's "1번"); every test that starts real Docker or Compose (the owner's "2번"); the tests of
   which checks a change calls for (the owner's "3번").
3. Ports: two emulators never meet on a port because the allocation steps on when a port is taken, by 2 at a time
   (the emulator's port and the one beside it), until a free pair is found, in `pm-worktree`'s slots and wherever
   else a script picks a port; no test of it.
4. From now on a harness issue adds no test, but for a new way a script could harm disk, memory or CPU. The
   harness-engineer brief, the `pm`'s SKILL (how it judges a harness change: by reading the change and, where it can,
   by running it once), root `AGENTS.md` (the harness-engineer's row "runs the harness tests of what it touches")
   and `issues/README.md` say so.
5. What depended on the tests follows: `pm-check`'s harness step (it runs what is kept, in seconds), `_pmscope`'s
   always and on-touch lists, `.github/workflows/main.yml` and `.github/ci` where they run harness tests, the check
   ids `harness.*` in `Issue-Check-Ids` and `pm-issue close --checks` (a harness issue is closed without a check id
   when no kept test shows it; closed issue files keep their old ids as history), the manifest or list that maps
   ids to files, and `pm-merge`'s question of a harness unit's record.

A fault of the harness found in use is fixed in the script; no test is added for it.

## Evidence

`.pm/run/check-durations.jsonl` (harness-test, last 30 runs); `.pm/run/flakes.jsonl` of 2026-11-19; issues 504, 509, 510.

## Steps to Reproduce

Change one line of a harness script and run `pm-check`.

## Expected

The harness step ends in seconds and fails only when a script could harm the machine.

## Out of scope
