Issue-Id: 502
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-check-stop|integration-emulator-left
Issue-Check-Ids:
Issue-Commit: 682def9105d1691bd07be0f0226ea10ea3fe736f

# Remove the integration emulator and its folder when pm-check --stop ends a run in its integration step

> Identified against commit `682def9105d1691bd07be0f0226ea10ea3fe736f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check <worktree> --stop` ends the run while `tests/integration/run` is in its checks, but the run's emulator
container (`emuforge-it-<port>-<run id>`) stays up and its folder `~/.aws/emulator/<port>/` stays. The next run on that
worktree's port then refuses at once: every integration check errors with `~/.aws/emulator/<port> already exists; a
leftover would be mistaken for this run's files`, and `test_compose_side_by_side` errors twice
(`leftover: ~/.aws/emulator/<port> exists`), so the next `pm-check` is NOT PASSED for a cause no change made. The
runner has `trap cleanup EXIT`, and `pm-check`'s `stop`/`on_signal` end the step's process group with SIGTERM and then
SIGKILL after 10 s (`end_group`); the cleanup did not remove the container or the folder.

## Evidence

- i497-harness-engineer, worktree `emuforge-497-h1` (emulator port 9319): `pm-check --stop` printed
  `stopped pm-check pid 26389 (step integration)` about 13:00 on 2026-11-19 (KST).
- Afterwards `docker ps` showed `emuforge-it-9319-1795060626-27661 127.0.0.1:9319->9319/tcp Up 35 minutes`, and
  `~/.aws/emulator/9319` was there (modified 12:57:25).
- The next run, `pm-check` on `682def9` (record `output/checks/2026-11-19T133231.json` in that worktree):
  `integration error 5.5s`, 275 error checks all with the leftover message; `harness-test failed` with 12 errors in
  `test_compose_side_by_side.SideBySide`, all from `leftovers()`.
- Removed by hand as pane-mode says: `docker rm -f` of the container, then `pm-emulator-dir rm --worktree`.

## Steps to Reproduce

1. In a worktree, start `pm-check <worktree>` on a change whose scope calls the integration step.
2. Once its record's step is `integration` and the emulator container is up, run `pm-check <worktree> --stop`.
3. `docker ps --filter label=emuforge-it-run` and `ls ~/.aws/emulator/<port>`: both are still there.

## Expected

After `--stop` (or SIGTERM/SIGINT to `pm-check`) ends a run in its integration step, the run's emulator container,
its volumes and `~/.aws/emulator/<port>/` are gone, as after a run that ends by itself, so the next `pm-check` on
the worktree starts clean. A harness test stops a run in that step and finds nothing left.

## Out of scope

The leftover guards themselves (`tests/integration/run`'s and `test_compose_side_by_side`'s): they refuse rightly.
