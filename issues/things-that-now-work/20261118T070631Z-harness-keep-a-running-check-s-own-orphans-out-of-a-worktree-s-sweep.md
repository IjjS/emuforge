Issue-Id: 477
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|orphan-sweep-during-a-check|bug
Issue-Check-Ids: harness.orphans harness.orphan-event harness.emulator-image
Issue-Commit: 21aead0a015e087724eb79ece5e43b5169b8c39f

# Keep a running check's own orphans out of a worktree's sweep

> Identified against commit `21aead0a015e087724eb79ece5e43b5169b8c39f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The sweep of a worktree W (`pm-pane reset` and `close`, `pm-worktree rm` and `orphans --stop`) and the daemon's
`EVENT orphans` leave out the live `pm-check` recorded in `W/output/checks/running.json` and the members of the
step group that record names, and nothing else. The stand-ins that the harness's own tests start while that check
runs, those of `test_orphans.py` and `test_orphan_event.py`, are real orphans. Their working directories are under
`W/output/tests/…`, and they run in sessions of their own, so they are not in the step group. Any of these can
therefore stop them in the middle of a case and make W's check fail for no reason in the code:

- a `pm-pane reset` of W's pane on `EVENT ctx` while the check runs;
- a `pm-pane close` of it;
- an `EVENT orphans` (60 s hold), then the `pm`'s prompt to the pane, or `EVENT orphans again`, then
  `pm-worktree orphans W --stop`.

The reference is requirement R2 to R6 of issue 472: a running `pm-check` is not a source of orphans and must not
be disturbed by the sweep.

## Evidence
- Review `impl-h1` r1 of issue 472 (`.pm/issue-472/review-impl-h1-r1.md`, P2).
- `.pm/bin/_pmorphans.py` `recorded` (line 181): it keeps out the recorded `pm_check_pid` and the PIDs whose
  `pgid` is the record's `pgid`, and nothing else.
- `.pm/bin/tests/test_orphans.py` line 241 (the driver's `spawn`) and 413 (the driver itself): processes started
  with `start_new_session=True`, so not in the step's group. Its `orphan.py` stand-in forks and its starter exits,
  so the child's parent is PID 1 and its cwd is a folder beside the fixture, under `W/output/tests/orphans/`.

## Steps to Reproduce
1. In a worktree W, start `pm-check W` so that it runs the harness step with `test_orphans.py`.
2. While a case of `test_orphans.Sweep` waits on its stand-ins, run `pm-worktree orphans <W's name>`.
3. The stand-ins of that case are listed as orphans of W; with `--stop` they are stopped, and the case fails.

## Expected
- While a live `pm-check` is recorded in W, `pm-worktree orphans <W>` does not list a process that the check's
  step started, directly or through processes of its own session, and `--stop` does not signal one.
- `pm-pane reset` and `close` of W's pane during that run do not stop them, and print a line that says so.
- The daemon does not tell them in `EVENT orphans`.
- An orphan of W that no running check started is still found and stopped as before.

## Out of scope
- Orphans in the main checkout; containers of any kind.
- Changing how the harness tests start their stand-ins.
