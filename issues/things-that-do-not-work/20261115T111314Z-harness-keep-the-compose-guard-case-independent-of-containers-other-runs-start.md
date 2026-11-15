Issue-Id: 28
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|test_compose_side_by_side-guard|shared-docker-state
Issue-Check-Ids:
Issue-Commit: 08dde044b9d1d6a864e4cfd2f5c91b9c51f53e46

# Keep the compose guard case independent of containers other runs start

> Identified against commit `08dde044b9d1d6a864e4cfd2f5c91b9c51f53e46`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`.pm/bin/tests/test_compose_side_by_side.py` `Guard.test_guard_refuses_fixed_names` (issue #6) lists every
container labelled `com.docker.compose.project=emuforge` before and after it calls `guard()`, and asserts that the
two lists are equal. The list covers containers that the case does not own. When another run on the same machine
starts or removes one of them in that window (another worktree's checks, or the owner's emulator), the case fails,
although `guard()` started nothing. The case should prove that `guard()` creates or changes nothing, whatever other
processes on the machine do.

## Evidence

`pm-check /Users/injae/Documents/GitHub/emuforge-8-h1` on commit `08dde044b` (issue #8 unit h1, `main` at `b54c63f`
merged), third run: `NOT PASSED commit=08dde044b failed=['harness-test']`. Log kept at
`output/logs/check-harness-test-08dde04-run3.log` in that worktree:

```
FAIL: test_guard_refuses_fixed_names (test_compose_side_by_side.Guard.test_guard_refuses_fixed_names)
  File ".../.pm/bin/tests/test_compose_side_by_side.py", line 898, in test_guard_refuses_fixed_names
    self.assertEqual(project_containers(OWNER_PROJECT, env), before)
AssertionError: Lists differ: [('3e17f739b40a...', 'exited') ...] != [('2c8d1de2a095...', 'running') ...]
Second list contains 1 additional elements.
First extra element 4:
('f099d67da7a0...', 'running')
```

The two runs before it, on the same commit, passed this case (`harness-test` passed in the first run, the second
failed only on #25). Other panes were running checks at the same time. Issue #8 does not touch Docker, Compose or
this test file.

## Steps to Reproduce

1. Run `cd .pm/bin/tests && PYTHONPATH=.. python3 -m unittest test_compose_side_by_side.Guard` in a checkout of
   `main`.
2. While it runs, start or remove any container labelled `com.docker.compose.project=emuforge`, for example
   another worktree's check run that brings up an emulator under that project label.
3. The case fails at line 898 with `Lists differ`.

## Expected

- `Guard.test_guard_refuses_fixed_names` passes while other processes create or remove containers of the
  `emuforge` project, and still fails when `guard()` itself creates or changes a container.

## Out of scope

- The behavior of `guard()` itself and the other compose cases.
- Stopping, restarting or recreating the owner's emulator on port 9297.
