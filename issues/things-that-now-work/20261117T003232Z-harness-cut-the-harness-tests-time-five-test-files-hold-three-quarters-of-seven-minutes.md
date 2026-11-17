Issue-Id: 328
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|harness-tests|run-time
Issue-Check-Ids: harness.on-touch
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Cut the harness tests' time: five test files hold three quarters of seven minutes

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The harness tests (`.pm/bin/tests/run`, the `harness-test` step of `pm-check`) take seven to ten minutes: 426 s
on `feat/55-e1` and 586 s on `feat/63-h2` on 2026-11-17. Every unit that changes a harness file, a guide the
harness tests read, or `tests/integration/run` runs them, and a failure runs them a second time.

A run with each test timed (issue 315's probe) shows where the time goes: five of thirty files hold 317 of
430 seconds.

| File | Tests | Seconds | What its time is |
|---|---|---|---|
| `test_capture.py` | 51 | 122.5 | a real headless Chromium per case; three cases wait out a bound of about 11 s for a page that never settles |
| `test_hang.py` | 42 | 83.2 | real processes sampled and signalled; most cases take 3 to 6 s |
| `test_emulator_dir.py` | 54 | 38.2 | one case waits 10 s for a `docker` that does not answer |
| `test_check_issue.py` | 20 | 37.7 | `pm-check` started on fixture checkouts; cases of 4 to 7 s |
| `test_emulator_telemetry.py` | 46 | 35.9 | real emulator containers; three cases of about 11 s |

The other 25 files take 113 s together. What the requirement has to settle: which of these waits are the
subject (a bound that must be seen to run out) and which can be given a shorter bound through a parameter the
test sets, without a case asserting less; and whether the tests of one tool can run only when that tool's files
changed, as `pm-scope` already decides for modules. Running test files side by side is not the way (owner
decision of 2026-11-17 on issue 315: the machine's computing is not plentiful).

## Evidence

- `.pm/issue-315/probe/harness-durations.out` (seconds per file and the thirty slowest tests) and
  `harness-durations.log` (the unittest output), made by `.pm/issue-315/probe/harness_durations.py` on
  2026-11-17 in the main checkout: 783 tests, 445.1 s. In that run 186 tests of seven files that build a fixture
  repository (`test_issue_branch`, `test_records`, `test_merge_scope`, `test_scope`, `test_integration_not_run`,
  `test_merge_units`, `test_issue_commit`) ended in an error at once, because `git` on the machine refused to
  run at that hour ("You have not agreed to the Xcode license agreements"); their seconds in the table of the
  output are too low, and the five files above are not among them.
- `../emuforge-63-h2/output/checks/last.json`: `harness-test` passed in 585.6 s (2026-11-17 08:56).
- Issue 315's file, Description: `harness-test` 426.1 s on `feat/55-e1`.

## Steps to Reproduce

1. `pm-check <worktree> --only harness` in a checkout.
2. Read the `harness-test` step's seconds in the output.

## Expected

- The `harness-test` step takes clearly less than today on this machine; the requirement names the target from
  a measurement with every test passing.
- No test asserts less than it does today, and no test file is left out of a run that changes the tool it tests.

## Out of scope

- Running test files or checks side by side (owner decision of 2026-11-17).
- The integration step's time (issue 315) and the checks an issue branch runs (issue 327).
