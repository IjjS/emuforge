Issue-Id: 491
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|pm-check-stop|leaves-run-emulator
Issue-Check-Ids:
Issue-Commit: 82a6572d6c2f07ce6002d179f1d96a9d4c8c0670

# Make pm-check --stop remove the integration run's emulator container, folder and images

> Identified against commit `82a6572d6c2f07ce6002d179f1d96a9d4c8c0670`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check <worktree> --stop`, run while the step `integration` runs, ends the check but leaves what
`tests/integration/run` had started for that run: the run's emulator container `emuforge-it-<port>-<run id>` keeps
running, its folder `~/.aws/emulator/<port>/` stays, and the run's three images (`emuforge-it-product-<run id>`,
`emuforge-it-emulator-<run id>`, `aws-emulator:it-<run id>`) stay. The next `pm-check` of the same worktree then
fails at once: `run` refuses with "`~/.aws/emulator/<port>` already exists; a leftover would be mistaken for this
run's files", every integration check is `error`, and the harness tests of `test_compose_side_by_side` fail with
"leftover: … exists".

## Evidence

- Issue 484, worktree `emuforge-484` (ports `studio` 8115, `engine` 8315, `emulator` 9315): `pm-check --stop` at
  step `integration` ("stopped pm-check pid 14081 (step integration)"). The next whole check, on 82a6572d6, reported
  `integration error` with 230 error checks, each "/Users/…/.aws/emulator/9315 already exists", and `harness-test`
  failed ("test_compose_side_by_side.CheckError: leftover: …/9315 exists"); logs `emuforge-484/output/logs/
  check-integration.log` and `check-harness-test.log` of that run.
- After it, `docker ps -a` still listed `emuforge-it-9315-1795021528-16179  Up 32 minutes`; the run id is in that
  run's `output/logs/integration-product-build.log`. The plan removed the container, the folder (`pm-emulator-dir rm
  --worktree`) and the three images of that run by hand.

## Steps to Reproduce

1. `pm-check <worktree>` on a branch whose scope runs `integration`.
2. While the step `integration` runs, `pm-check <worktree> --stop`.
3. `docker ps --filter name=emuforge-it-<emulator port>-` and `ls ~/.aws/emulator/<emulator port>`.
4. `pm-check <worktree>` again.

## Expected

After `--stop`, nothing of the stopped run is left: `run`'s own cleanup (its emulator container, labelled containers
and volumes, product projects, its folder and its images) has run, and the next `pm-check` starts clean.

## Out of scope

The cleanup of a run that is killed outright (`SIGKILL`, a machine restart); a pane that stops a check of another
worktree.
