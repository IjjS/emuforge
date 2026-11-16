Issue-Id: 48
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|test_compose_side_by_side-cannotrun|cpu-dependent-preflight
Issue-Check-Ids:
Issue-Commit: 3dded6e0fcb303efd8aac1227d9d6941ad739e13

# Keep the compose cannot-run cases independent of the machine's CPU load

> Identified against commit `3dded6e0fcb303efd8aac1227d9d6941ad739e13`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`.pm/bin/tests/test_compose_side_by_side.py` `CannotRun.test_missing_image_is_an_error_and_nothing_is_built_or_pulled`
and `CannotRun.test_unreachable_docker_is_an_error_naming_docker` each expect `side_by_side()` to fail for one cause
(an image that is not present, a Docker socket that does not exist). `preflight()` runs the real `pm-mem --check`
first, and that check fails when the machine's CPU is above 90%. Under load the cases then get the memory error
instead of the one they test, and fail although the code under test is right. Whether they pass depends on the CPU
at the moment they run, so they can fail any branch's harness step.

## Evidence

`pm-check /Users/injae/Documents/GitHub/emuforge-46-t1 --only harness --no-retry` on commit `3dded6e` (issue #46
unit t1, which does not touch this file), `output/logs/check-harness-test.log` in that worktree:

```
FAIL: test_missing_image_is_an_error_and_nothing_is_built_or_pulled (test_compose_side_by_side.CannotRun...)
AssertionError: 'emuforge-test-missing-image-6' not found in 'memory: .../.pm/bin/pm-mem --check exited 1, no
emulator is started: used 18.8GB swap 4.7/6.0GB cpu 100%\nOVER limit: cpu 100% > 90%'
FAIL: test_unreachable_docker_is_an_error_naming_docker (test_compose_side_by_side.CannotRun...)
AssertionError: 'Docker' not found in 'memory: .../.pm/bin/pm-mem --check exited 1, no emulator is started: used
19.3GB swap 4.7/6.0GB cpu 93%\nOVER limit: cpu 93% > 90%'
```

The same file passed both cases in the run before, on `83702b4` of the same branch, with the same `main`. Other
worktrees were running checks at the time.

## Steps to Reproduce

1. Load the machine above 90% CPU (for example two `pm-check` runs of other worktrees).
2. Run `.pm/bin/tests/run` (or `pm-check <worktree> --only harness --no-retry`).
3. The two cases fail with the `memory:` error of `preflight()`.

## Expected

Each of the two cases reaches the cause it tests whatever the machine's load: for instance by passing
`side_by_side()` a `pm_mem` that passes (as `test_memory_over_the_limit_is_an_error_and_nothing_starts` passes one
that fails), so the real `pm-mem` is exercised only by the cases that test it.

## Out of scope

- `pm-mem`'s limits and the CPU wait of `pm-check`.
- `Guard.test_guard_refuses_fixed_names` and shared Docker state (issue #28).
