Issue-Id: 31
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|test_terminate-snapshot-run|slow-under-memory-pressure
Issue-Check-Ids:
Issue-Commit: d009b29c5fdb1b3c59b60e6d3d9d073fe0903fe4

# Make the pm-structure terminate snapshot case end within its bound under memory pressure

> Identified against commit `d009b29c5fdb1b3c59b60e6d3d9d073fe0903fe4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`SnapshotRun.test_snapshot_run_signal_while_scoring` in `.pm/bin/tests/test_terminate.py` (issue #12) signals a
`pm-structure --snapshot` run of a 60 MiB snapshot once its lock file exists and expects exit 2 within
`SNAPSHOT_EXIT_BOUND` (15 s). On a machine short of memory the run took 32.9 s from the signal to its exit. It did
exit 2 with the expected stderr and stdout lines, so only the time bound failed. In `pm-structure`'s `score_run` the
stop is delivered at checkpoint C2, after `_pmscore.load_snapshot` and `_pmscore.score` have both finished. The
signal usually arrives while the 60 MiB JSON is being parsed, so the time to exit is the whole load and score of
the snapshot (about 2.3 s on a quiet machine, per #12's criteria). The reference is #12's requirement: a run stopped
by a signal exits 2 within the case's bound.

Found while planning issue #25 (the browser cases of the same file). It is a different case with a different
cause, so it is filed here instead of being planned into #25.

## Evidence

- Main checkout at `d009b29`, `cd .pm/bin/tests && PYTHONPATH=.. python3 -m unittest test_terminate`, log
  `.pm/issue-25/logs/terminate-alone-0.log`: `FAIL: test_snapshot_run_signal_while_scoring` /
  `AssertionError: 32.92055774992332 not less than 15 : exit 2 32.9 s after the signal`; stderr
  `pm-structure: terminated by SIGTERM`. Machine at that moment: `used 19.8GB swap 11.3/12.0GB` (`pm-mem --check`
  passed), load average 65.6 on 12 CPUs.
- The ten runs that followed (`.pm/issue-25/logs/terminate-alone-{1..10}.log`, load 7 to 11, swap 9.4 to 9.5/11.0GB)
  did not fail this case.

## Steps to Reproduce

1. In a checkout of `main` with `@playwright/test` in `studio/node_modules`, bring the machine close to its memory
   limit (swap nearly full).
2. Run `cd .pm/bin/tests && PYTHONPATH=.. python3 -m unittest test_terminate.SnapshotRun` several times.
3. A run can exceed the 15 s bound while still exiting 2.

## Expected

- `test_snapshot_run_signal_while_scoring` passes on twenty consecutive runs while `pm-mem --check` passes, alone
  and inside `pm-check`'s `harness-test`.
- A `--snapshot` run sent SIGTERM while it loads or scores its snapshot exits 2 within the case's bound.

## Out of scope

- The browser cases of `test_terminate.py` (issue #25).
- Loosening `SNAPSHOT_EXIT_BOUND` without naming why the time is slow by nature.
