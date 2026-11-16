Issue-Id: 67
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|relay-loopback-check|emulator-1.0.471-describe-endpoints
Issue-Check-Ids: engine.relay-stays-on-loopback
Issue-Commit: 921b2b3ab0966850719fc9c80cbc7bcfe7af5294

# Find out why the loopback relay check's premise no longer holds on emulator 1.0.471

> Identified against commit `921b2b3ab0966850719fc9c80cbc7bcfe7af5294`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main` on GitHub Actions for commit `65023c6` failed in `integration`, in both of its runs, on one
check: `engine.relay-stays-on-loopback`. The check first asks the emulator directly for DynamoDB's
`DescribeEndpoints` and expects the answer to name `dynamodb.us-east-1.localhost:9297`; on the runner the
answer named the address the request was sent to (`127.0.0.1:<port>`), so the check stopped at its premise
("the Given does not hold") before testing the engine.

The pushed commits change harness files only (issues #50, #63). What differs from the earlier, successful runs
is the emulator: the runner's image is built from the package's `latest` at each run
(`infra/aws-emulator/Dockerfile`), and this run had emulator 1.0.471 where the runs of 2026-11-16 had 1.0.385.
The local image is older still (1.0.364). So the emulator's answer changed between versions, and nothing pins
the version the runner checks against.

Two things are open: whether the engine still keeps a relayed `DescribeEndpoints` on loopback with the new
answer (the check never got that far), and that a new emulator release can turn `main`'s run red without any
change of the repository.

## Evidence

Run https://github.com/IjjS/emuforge/actions/runs/43914669741 (2026-11-16T17:05Z), failed steps' log saved at
`.pm/run/ci-65023c608.log` (main checkout, local):

```
test relay_stays_on_loopback ... FAILED
assertion failed at tests/../support/check.rs:225:9: engine.relay-stays-on-loopback: error: DescribeEndpoints
sent directly names 127.0.0.1:58309, not dynamodb.us-east-1.localhost:9297 (§E-H); the Given does not hold
relay fidelity … emulator 1.0.471
```

Runs 43891516913 and 43867207675 (emulator 1.0.385) passed the same check.

## Steps to Reproduce

1. Build the emulator image today (`docker build --no-cache infra/aws-emulator`), so it holds 1.0.471 or later.
2. Run `tests/integration/run engine.relay-stays-on-loopback` against it.

## Expected

- It is known, from the emulator itself, what `DescribeEndpoints` answers in 1.0.471 and what a client does
  with it; the check's premise is written for the versions EmuForge supports, and the engine's handling of the
  answer is checked on the new one.
- The issue says whether the emulator version of a run should be pinned or recorded so that a release of the
  emulator shows as such and not as a failure of an unrelated push; a change of that rule is the owner's.
