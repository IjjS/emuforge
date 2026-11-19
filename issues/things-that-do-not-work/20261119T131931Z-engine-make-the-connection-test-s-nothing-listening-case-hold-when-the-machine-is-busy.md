Issue-Id: 534
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|core.check-test-nothing-listening|flaky
Issue-Check-Ids:
Issue-Commit: 8606125d83a14e5f4e24c05f67d13f735ad01da3

# Make the connection test's nothing-listening case hold when the machine is busy

> Identified against commit `8606125d83a14e5f4e24c05f67d13f735ad01da3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`test_with_nothing_listening_fails_at_connection_refused` (`engine/crates/emuforge-core/tests/check.rs`, about line 297)
failed once in a check run of issue 516's unit `s3` and passed when `pm-check` ran the step again; the unit changed
no engine file. The test binds a loopback port, drops the listener and expects the connection step to fail with
`ConnectionRefused`; it got `Timeout`. The test runs with `#[tokio::test(start_paused = true)]`: with the clock
paused, tokio advances time by itself whenever the runtime is idle, so on a busy machine the probe's deadline can
fire before the refused connection is seen. The test's own stated behavior is that nothing listening is reported as
a refused connection, every time.

## Evidence

- `.pm/run/flakes.jsonl`, the line of 2026-11-19T22:18:08+09:00 (checkout `emuforge-516-s3`, commit `07e4ab3c`, step
  `engine-test`).
- Its first attempt's log (`output/logs/check-engine-test.attempt1.log` of that worktree, not kept after it is removed):

```
thread 'test_with_nothing_listening_fails_at_connection_refused' panicked at crates/emuforge-core/tests/check.rs:304:5:
assertion `left == right` failed
  left: [("files", Passed), ("connection", Failed(Timeout)), ("tls", NotRun), ("health", NotRun), ("credentials", NotRun)]
 right: [("files", Passed), ("connection", Failed(ConnectionRefused)), ("tls", NotRun), ("health", NotRun), ("credentials", NotRun)]
test result: FAILED. 11 passed; 1 failed
```

- The cause given above is the plan's reading of the test, not proven by a run.

## Steps to Reproduce

1. On a machine under load (several check runs at once), run `cargo test -p emuforge-core --test check` in `engine/`
   repeatedly.
2. The case fails now and then with `Failed(Timeout)` where it expects `Failed(ConnectionRefused)`.

## Expected

- The case passes on every run, whatever the machine's load, and still proves that nothing listening is reported as
  `ConnectionRefused` and not as a timeout.

## Out of scope

The connection test's behavior in the product; the other cases of the file unless they share the cause.
