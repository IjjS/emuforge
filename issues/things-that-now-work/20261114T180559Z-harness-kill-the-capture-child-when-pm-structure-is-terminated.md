Issue-Id: 12
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-structure-terminated-child|cleanup
Issue-Check-Ids: harness.proc harness.terminate
Issue-Commit: 6392e41fb16259aaffe741be6f84dec6fa404fd2

# Kill the capture child when pm-structure is terminated

> Identified against commit `6392e41fb16259aaffe741be6f84dec6fa404fd2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

When `pm-structure` receives SIGTERM or SIGHUP during a browser run, it does not stop until the capture
child ends by itself, which can take up to 120 s. Its signal handler raises `SystemExit` so the `finally` blocks
run. But `_pmproc.run` kills the child's process group only on `subprocess.TimeoutExpired`. Any other exception
leaves `communicate()` and goes into the `with Popen` exit, which waits for the child. `node` and Chromium run in
their own session (`start_new_session=True`), so the signal never reaches them. For that whole time the run's
lock (`output/structure/<screen>-<state>.lock`) and job file stay in place, and the static server keeps running.

## Evidence

- `.pm/bin/_pmproc.py` (`run`): `except subprocess.TimeoutExpired:` is the only path to `os.killpg`.
- `.pm/bin/pm-structure` (the `__main__` block): SIGTERM and SIGHUP call `sys.exit(2)` to unwind through `finally`.
- Found by the implementation review of issue 4, unit h2: `.pm/issue-4/review-impl-h2-r1.md`, P3.

## Steps to Reproduce

1. Run `pm-structure <wt> <spec> --serve <dir>` against a page that never settles. The fixture
   `.pm/bin/tests/fixtures/structure/pages/restless` takes the full 10 s settle bound, and a page that hangs
   navigation takes up to 60 s.
2. Send SIGTERM to the `pm-structure` process while the browser runs.
3. The process stays until the capture child exits. The `node` process and the lock file remain during that
   time.

## Expected

A terminated `pm-structure` kills the capture child's process group at once and exits 2. No `node` or Chromium
process of the run, lock, job file or script copy remains after it exits.

## Out of scope

SIGKILL of `pm-structure`, which no handler can catch. A lock left by a killed run is already replaced
by the next run, because its PID is gone.
