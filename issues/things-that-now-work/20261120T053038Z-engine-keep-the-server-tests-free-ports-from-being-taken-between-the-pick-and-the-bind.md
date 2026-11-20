Issue-Id: 576
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|server-tests.free-port|port-taken-between-pick-and-bind
Issue-Check-Ids: engine-test
Issue-Commit: de75dd4dc2d4a109a752bfe6c62d2580ac505d0a

# Keep the server tests' free ports from being taken between the pick and the bind

> Identified against commit `de75dd4dc2d4a109a752bfe6c62d2580ac505d0a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check .` on `main` at `68ba2ca42` (2026-11-20, the run after the emulator image moved to 1.0.533) failed its step
`engine-test` on one test of `engine/crates/emuforge-server/tests/config.rs`,
`serve_without_studio_and_an_allowed_name_warns_it_has_no_effect_and_serves_the_engine`: `serve` ended with
`Bind { addr: 127.0.0.1:61895, flag: "--port", … AddrInUse }`. The other 42 tests of the file and every other step
passed, the integration step included, so the emulator's new version is not the cause.

The test takes its ports from `free_port()` (`config.rs:919`): it binds port 0, reads the number and drops the
listener, and `serve` binds that number later. Between the two, any process of the machine may be given the port. At
the time of the run `pm-probe-services` started an emulator on a free loopback port of its own (61906) and the
integration step of other work was starting engines; the test's port went to one of them. The file calls
`free_port()` in four places, so every test that builds a `Config` from it can fail the same way when the machine is
busy, on a developer's machine or on GitHub Actions. This is not issue 533's fault (a wait for a log line, fixed) nor
issue 571's (the integration run's own engine port).

## Evidence

`.pm/run/evidence/main-check-1.0.533-engine-test.log` (the step's log, its last lines); `.pm/run/main-check-1.0.533.log` (the run's record lines).

## Steps to Reproduce

Intermittent. Run `cargo test -p emuforge-server --test config` while other processes open many loopback ports (an integration run, `pm-probe-services run`).

## Expected

A test of the server never loses the port it serves on to another process: the port is held from the pick to the bind (for example `serve` is given a bound listener or port 0 and the test reads the port it got), in every place the tests use `free_port()` for a port that is bound later. A port that must be closed (nothing listening) is a separate case and stays as issue 533 left it.

## Out of scope

The integration run's engine port (issue 571).
