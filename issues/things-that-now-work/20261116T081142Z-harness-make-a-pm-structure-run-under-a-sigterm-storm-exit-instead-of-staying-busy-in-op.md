Issue-Id: 50
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-structure-signal-storm|busy-in-open-under-storm
Issue-Check-Ids: harness.storm-wait harness.terminate
Issue-Commit: 424d7ad0ea51921ba0de9decbdafd9a85aa0c223

# Make a pm-structure run under a SIGTERM storm exit instead of staying busy in open()

> Identified against commit `424d7ad0ea51921ba0de9decbdafd9a85aa0c223`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`test_terminate.BrowserRun.test_signal_storm_exits_2_with_one_line_each`, subtest `SIGTERM`, failed once in twenty
runs of `pm-check <worktree> --only harness --no-retry` on `feat/31-h1` at `424d7ad` (run 14; runs 1 to 13 and
15 to 20 passed). The case sends SIGTERM without pause to `pm-structure --serve pages/restless` and
`pm-structure` was still unreaped 180 s (`RUN_BOUND`) later. Issue #37's sampler caught it this time: the process
was not waiting but busy, 2:55 of CPU time in about 180 s, and every one of the 2372 samples of its main thread
is in the same place, inside the libc `open` that Python's `open()` calls (`_io_open` -> `_io_FileIO___init__` ->
`open` -> `__open`), reached through `builtin_next` -> `gen_iternext` from the script's top level. A
`next()` on a generator that opens a file fits a `contextlib.contextmanager`'s `__enter__`; in `pm-structure`'s
`--serve` path `_pmbrowse.serve` opens its log with `open(log, "w")` before it yields. That is a reading of the
stack, not shown: the sample has no Python frames. The pattern fits `open()` being interrupted by each signal,
Python running the handler and retrying (PEP 475), with the storm never leaving the call room to finish.

The machine was not out of memory: `pm-mem --check` before the run: `used 17.6GB swap 4.5/6.0GB cpu 14%`. The
run was slow overall (harness-test 1571 s, the other runs about 340 s). Issue #37 (closed, `harness.hang`) added
the sampler for this hang; its Expected names a starvation in `pm-structure` or `_pmproc` as a cause to fix.

Found while verifying issue #31 unit `h1`, whose change (`_pmscore` looks during the snapshot load and the
scoring) is not on this path: a `--serve` run of a page that never settles never loads a snapshot.

## Evidence

Copies under `.pm/issue-31/logs/h1-storm-hang/` (the originals are in the `feat/31-h1` worktree's `output/`):

- `harness-test-run14.log`: the run's log.

  ```
  FAIL: test_signal_storm_exits_2_with_one_line_each (test_terminate.BrowserRun.test_signal_storm_exits_2_with_one_line_each) (case='SIGTERM')
  AssertionError: pm-structure did not exit within 180 s of a storm of SIGTERM
  Ran 472 tests in 1571.248s
  FAILED (failures=1)
  ```

- `hang-test_signal_storm_exits_2_with_one_line_each-33814.ps`: `33814 28718 33814 Ss - 2:55.56 ... pm-structure
  <wt-SIGTERM> .../bucket-list.yaml --serve .../pages/restless --port 59932`.
- `hang-test_signal_storm_exits_2_with_one_line_each-33814.sample`: macOS `sample` of the hung run; main thread
  2372 of 2372 in `run_mod -> PyEval_EvalCode -> _PyEval_EvalFrameDefault -> builtin_next -> gen_iternext ->
  gen_send_ex2 -> _PyEval_EvalFrameDefault -> PyObject_Vectorcall -> _io_open -> ... -> _io_FileIO___init__ ->
  open -> __open`.
- `pm-mem-before-run14.txt`: `used 17.6GB swap 4.5/6.0GB cpu 14%`.

## Steps to Reproduce

1. From `.pm/bin/tests`: `PYTHONPATH=.. python3 -m unittest test_terminate.BrowserRun.test_signal_storm_exits_2_with_one_line_each`,
   repeatedly; or `pm-check <worktree> --only harness --no-retry` repeatedly (1 of 20 here).
2. A hung run leaves `output/logs/hang-*.ps` and `hang-*.sample` (issue #37's sampler).

## Expected

- The place of the busy `open()` is named in the Python code (which call, which file).
- A `pm-structure` run under a storm of SIGTERM, SIGHUP or SIGINT exits 2 within `RUN_BOUND`, also when a storm
  arrives while it opens a file.

## Out of scope

- Loosening `RUN_BOUND` or any other bound of `test_terminate.py`.
- A signal before `pm-structure` has installed its handler (issue #25, requirement section 8).
- Issue #31's look during the snapshot load and the scoring.
