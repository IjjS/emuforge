Issue-Id: 25
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|test_terminate-browser-runs|intermittent
Issue-Check-Ids: harness.proc harness.terminate
Issue-Commit: 3c8e746bb77424ae1077dcd04a1d430eb567bb23

# Make the pm-structure terminate browser cases pass on every run

> Identified against commit `3c8e746bb77424ae1077dcd04a1d430eb567bb23`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The browser cases of `.pm/bin/tests/test_terminate.py` (`BrowserRun`, issue #12) fail on some runs and pass on
others with the same code. Seen with `main`'s own `pm-structure`, `_pmspec.py` and `_pmscore.py` (commit
`73827dd`, issue #12 merged), so it is not caused by issue #8's changes. Two failure forms:

- `test_signal_leaves_nothing` (case `SIGTERM`) and `test_url_run_signal`: a `chrome-headless-shell` descendant of
  the run is still alive 5 s (`GONE_BOUND`) after `pm-structure` exited.
- `test_second_sigterm_changes_nothing`: `pm-structure` ends with exit `-15` (killed by SIGTERM) 0.2 s after the
  signal, after it had already printed its error `result:` line, instead of exit 2.

The reference is #12's requirement: every run stopped by a signal exits 2 and leaves no descendant, on every run.

## Evidence

Run in the worktree of issue #8 unit h1 (`/Users/injae/Documents/GitHub/emuforge-8-h1`), machine memory at
`used 15.1GB swap 8.3/9.0GB` (`pm-mem --check` passed):

- `pm-check` record `NOT PASSED commit=ff35f5474 failed=['harness-test']`, log `output/logs/check-harness-test.log`:
  `FAIL: test_url_run_signal (test_terminate.BrowserRun.test_url_run_signal)` /
  `AssertionError: Lists differ: [84838] != [] : descendants still alive 5 s after the exit: {84838:
  '.../chrome-headless-shell ... --headless ...'}`; 338 tests, 1 failure.
- `test_terminate` alone with the h1 scripts, three runs (`output/logs/terminate-rerun-{1,2,3}.log`): run 1
  `FAILED (failures=2)` (`test_second_sigterm_changes_nothing`: `AssertionError: -15 != 2 : exit -15 0.2 s after
  the signal`; `test_signal_leaves_nothing (case='SIGTERM')`: `Lists differ: [86441] != []`), runs 2 and 3 `OK`.
- `test_terminate` alone with `main`'s `pm-structure`, `_pmspec.py`, `_pmscore.py` checked out in the same
  worktree, four runs (`output/logs/terminate-main-{1..4}.log`): runs 1 to 3 `OK`, run 4 `FAILED (failures=1)`:
  `test_second_sigterm_changes_nothing`, `AssertionError: -15 != 2 : exit -15 0.2 s after the signal; stdout:
  result: .../s3.bucket-list-seeded.json`.

## Steps to Reproduce

1. In a checkout of `main` with `@playwright/test` and its Chromium in `studio/node_modules`, run
   `cd .pm/bin/tests && PYTHONPATH=.. python3 -m unittest test_terminate` five times in a row.
2. At least one run fails with one of the two forms of the description (more often while the machine is loaded,
   for example during a full `pm-check`).

## Expected

- `test_terminate` passes on twenty consecutive runs, alone and inside `pm-check`'s `harness-test`.
- A `pm-structure` run sent SIGTERM (once or twice) always exits 2 and leaves no `chrome-headless-shell` or `node`
  descendant alive 5 s after the exit.

## Out of scope

- Issue #8's wizard capture (per-step runs); the cases above run a `table` spec.
- Loosening `GONE_BOUND` or the expected exit status of the confirmed cases.
