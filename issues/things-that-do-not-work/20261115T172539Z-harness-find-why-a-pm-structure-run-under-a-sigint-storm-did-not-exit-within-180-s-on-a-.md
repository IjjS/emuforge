Issue-Id: 37
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-structure-signal-storm|no-exit-under-memory-pressure
Issue-Check-Ids:
Issue-Commit: 1b88c4785a55d7513a64636d2f876e1551452702

# Find why a pm-structure run under a SIGINT storm did not exit within 180 s on a swapping machine

> Identified against commit `1b88c4785a55d7513a64636d2f876e1551452702`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

One run of `test_terminate.BrowserRun` and `test_terminate.AfterReport` failed while issue #25's unit `h1` was
being verified, on `feat/25-h1` at `d65c353` (issue #25's D1 and D2 in place). In
`BrowserRun.test_signal_storm_exits_2_with_one_line_each`, subtest `SIGINT`, the case sent SIGINT to
`pm-structure --serve pages/restless` without pause from the moment Chromium ran, and `pm-structure` was still
unreaped 180 s (`RUN_BOUND`) later. The other two subtests (SIGTERM, SIGHUP) and the other nine cases passed in
the same run. Issue #25's requirement R1 says a run signalled repeatedly until it exits exits 2; under that storm
it normally exits 2 within 0.3 s.

The machine was swapping heavily at that time, and every case of that run was slow: the ten tests took 1572 s,
where the twenty counted runs after it took 9.0 to 10.2 s each. That fits a machine out of memory, but the hung
process was not sampled, so the cause is not shown. A process that a signal storm starves without end would
also explain it, and twenty clean runs do not rule that out.

## Evidence

- `.pm/issue-25/logs/h1-terminate-8.log` (copy of the run's log, written 2026-11-15 23:44 local). Its first
  line, printed by the run's own wrapper before the tests: `pm-mem --check: used 15.0GB swap 8.1/9.0GB cpu 18%`.
  Then:

  ```
  FAIL: test_signal_storm_exits_2_with_one_line_each (test_terminate.BrowserRun.test_signal_storm_exits_2_with_one_line_each) (case='SIGINT')
  AssertionError: pm-structure did not exit within 180 s of a storm of SIGINT
  Ran 10 tests in 1572.262s
  FAILED (failures=1)
  ```

- The runs before it on the same code, `terminate-1` to `terminate-7`, were `OK`. The machine was restarted
  during `terminate-9`.
- After the restart (swap 0.0/0.0 GB, load 4 to 20): 180 runs of the same storm, 60 each of SIGINT, SIGTERM and
  SIGHUP, by `.pm/issue-25/logs/h1-storm_probe.py`, which samples a run still unreaped 20 s into the storm: all
  exit 2 within 0.277 s, none hung (`.pm/issue-25/logs/h1-storm-probe-1.jsonl`). Twenty further runs of
  `BrowserRun` and `AfterReport` and twenty of `.pm/bin/tests/run` had no failure in these cases.

## Steps to Reproduce

1. On a machine whose swap is nearly full (as above), from `.pm/bin/tests`:
   `PYTHONPATH=.. python3 -m unittest test_terminate.BrowserRun.test_signal_storm_exits_2_with_one_line_each`,
   repeatedly.
2. Or run `python3 -I .pm/issue-25/logs/h1-storm_probe.py 60 SIGINT,SIGTERM,SIGHUP` (its paths name the
   `feat/25-h1` worktree; point `WT` at the checkout under test). A hung run leaves `output/logs/hang-*.ps` (its
   process tree with state and wait channel) and `hang-*.sample` (macOS `sample` of `pm-structure`).

## Expected

- The cause of the hang is named from a sample of a hung run, or the hang is shown to come only from the machine
  being out of memory.
- If it is a starvation or a deadlock in `pm-structure` or `_pmproc`: a `pm-structure` run under a storm of
  SIGTERM, SIGHUP or SIGINT exits 2 within `RUN_BOUND`, on a machine under memory pressure as well.

## Out of scope

- Loosening `RUN_BOUND`, `EXIT_BOUND` or `GONE_BOUND`.
- A signal before `pm-structure` has installed its handler (issue #25, requirement section 8).
