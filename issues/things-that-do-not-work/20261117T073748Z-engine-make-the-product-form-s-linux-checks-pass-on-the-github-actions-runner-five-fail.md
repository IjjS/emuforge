Issue-Id: 438
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|product-form|linux-first-run-on-actions
Issue-Check-Ids:
Issue-Commit: bf1146fe00065575b8ed64395c0ba815f8ba6dea

# Make the product form's Linux checks pass on the GitHub Actions runner: five fail in their first run there

> Identified against commit `bf1146fe00065575b8ed64395c0ba815f8ba6dea`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 54 was merged on its record on macOS, with the run of the push of `main` as its evidence on Linux (the
owner's decision of 2026-11-17). That run failed: of the 21 product checks that ran on the Ubuntu runner for
the first time, five failed in both attempts of the integration step; every other check passed (relay fidelity
23/23, emulator 1.0.486).

Two different failures:

- `engine.product-linux-file-renders-the-host-form`: the rendered mount of the engine has
  `"create_host_path": null` where the check expects `false`. Everything else of the mount is as expected
  (`read_only: true`, source `/home/runner/.aws/emulator`, type `bind`). Either the runner's Compose renders the
  key differently from the Compose of Docker Desktop the check was written against, or the Linux file does not
  set it: find out which.
- Four checks that start an emulator with the form or need the form healthy
  (`engine.product-ports-are-published-on-loopback-only`, `engine.product-first-start-without-aws-directory`,
  `engine.product-emulator-profile-starts-and-stops-an-emulator`,
  `engine.product-wrapper-starts-an-emulator-when-none-runs`): `GET /__emuforge/health` answers
  `emulator.reachable: false` and not `200` within the bound. The checks that use an emulator already running
  passed (`engine.product-start-with-running-emulator-connects`, `…-wrapper-uses-a-running-emulator`). Issue 55
  (the emulator image writes files the caller can read on Docker Engine on Linux) was not on `main` in this run
  and is the likely cause: establish it from the run of the push that carries issue 55, before changing
  anything.

## Evidence

Run https://github.com/IjjS/emuforge/actions/runs/44036944301 of `main` at `9261cf5`; failed steps' log
`.pm/run/ci-9261cf5.log` (main checkout), lines 176 to 189 and 295 to 338.

## Steps to Reproduce

1. Push `main` at `9261cf5`; read the workflow's integration step and its second run.

## Expected

- The five checks pass on the runner, and on macOS as before.
- No check is put back into `.github/not-run.json` to get there, unless the `pm` decides it with a reason.

## Out of scope

- Windows (issue 437).
