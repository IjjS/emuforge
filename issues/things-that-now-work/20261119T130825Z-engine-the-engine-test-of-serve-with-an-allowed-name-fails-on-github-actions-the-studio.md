Issue-Id: 533
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|serve|allow-host-test-reads-the-log-before-studio-says-it-listens
Issue-Check-Ids: engine-test
Issue-Commit: 382aec3a28ca3d26fa2fa389925ae2931ed3728b

# The engine test of serve with an allowed name fails on GitHub Actions: the Studio listener's line is not in the log yet

> Identified against commit `382aec3a28ca3d26fa2fa389925ae2931ed3728b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main.yml` for the push of `382aec3` failed at `engine-test`, twice (the step and its second run), on one
test of issue 503: `serve_with_studio_and_an_allowed_name_warns_and_binds_loopback_only`
(`engine/crates/emuforge-server/tests/config.rs:919`, the panic at line 946). The captured log holds the
`--allow-host` warning and `engine listening listen=127.0.0.1:<engine port>`, and the test then asserts
`listen=127.0.0.1:<port>` for the Studio port too (lines 945 to 947); that line was not in the log when the test
read it. The same test failed the same way in the run of `3e91a3f` (`.pm/run/ci-3e91a3f.log`), where the browser
installation's failure hid it. It passed in the runs of `6ea0934`, `8a5dadc` and `39901f4`, and passes on the
owner's machine: the test ends its capture as soon as both ports accept, which on a slower runner can be before the
Studio listener has logged its line. Whether the fault is the test's (it reads too early) or the server's (it logs
after it accepts, or not at all on some path) is to be found first.

Filed from a run on GitHub Actions: it waits for the owner's signal.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44527166377 ; `.pm/run/ci-382aec3.log`, `.pm/run/ci-3e91a3f.log`.

## Steps to Reproduce

Intermittent on GitHub Actions (2 of the last 5 runs of `main`): `cargo test -p emuforge-server --test config`.

## Expected

The test passes on every run, or the server's line is there whenever the port accepts.

## Out of scope
