Issue-Id: 62
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|hang-sampler|keep-run-output-files-state-python-stack
Issue-Check-Ids:
Issue-Commit: e3e2027757e708c29b88927fb2c504a3fa4b1eda

# Keep a hung pm-structure run's output, file state and Python stack in the hang sample

> Identified against commit `e3e2027757e708c29b88927fb2c504a3fa4b1eda`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The sampler of a `pm-structure` run that passed its bound in `test_terminate.py` (`.pm/bin/tests/_hang.py`, issue
#37) keeps the process table of the run's tree and three seconds of `/usr/bin/sample`. For the one hang it has
caught so far (issue #50) that was not enough to say where the run was: `sample` shows C frames only, so the
Python call had to be worked out by elimination from the code; nothing recorded how far the run had come (whether
it had written its result file and its two lines, whether its lock was still there); and the two files lived only
in the worktree's ignored `output/logs/`, so they were gone with the worktree before the issue was planned.

There is no outside reference: the tool's own stated purpose is the reference (`_hang.py`'s docstring: the files
are what a reader of the failure uses to name the hang).

## Evidence
- `.pm/issue-50/requirement.md` sections 3.1 and 3.3: the place of the busy `open()` is "a reading of the code
  against the quoted stack; the sample itself is gone and had no Python frames", and which of two kinds of kernel
  wait it was cannot be told from what was kept.
- `git worktree list` on 2026-11-16 has no `feat/31-h1` worktree; no `hang-test_signal_storm*` file exists on the
  machine; `.pm/archive/31/` holds no `logs/`. The issue file of #50 quotes the files, nothing else is left.
- `.pm/issue-50/probe/storm_serve.py`: a copy of `pm-structure` that registers `faulthandler` on SIGUSR1 writes
  every thread's Python stack from a C-level handler, also while the main thread is inside an interrupted system
  call (`logs/probe-storm-serve-2.log`: 300 runs with it, exit status and lines unchanged).

## Steps to Reproduce
1. Read `.pm/bin/tests/_hang.py`: `_sample` writes `hang-<name>-<pid>.ps` and `.sample` and returns their excerpt.
2. Make any case of `test_terminate.py` give up (as `test_hang.py` does with its stand-in run) and read the
   failure message and the two files: no Python frame, no stdout or stderr of the run in the storm case
   (`TerminateCase.gave_up`), nothing about the run's result file or lock.

## Expected
- The failure message of a case that gave up, and a file beside the `.ps` file, hold the run's stdout and stderr
  up to that moment (bounded in size) in every place the sampler is called, also in `storm`.
- They say whether the run's result file and its lock file exist at that moment.
- They hold a Python stack of every thread of the hung run, taken without ending the run and without changing
  what a run that is not sampled does or prints.
- The sampler still sends nothing that can end or change the run it samples, still raises nothing, and a run
  that ends inside its bound is still not sampled.

## Out of scope
- Kernel stacks (they need root).
- Where the files are kept once the worktree is removed: that is the PM's archive step, not the sampler.
- Any bound of `test_terminate.py`.
