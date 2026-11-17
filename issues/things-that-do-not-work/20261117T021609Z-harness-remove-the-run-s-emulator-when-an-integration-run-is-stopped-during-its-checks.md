Issue-Id: 342
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|integration-run-stopped-during-checks|emulator-container-left
Issue-Check-Ids:
Issue-Commit: fdb6d8d23f8dfece65d178b77e85fd862df74a89

# Remove the run's emulator when an integration run is stopped during its checks

> Identified against commit `fdb6d8d23f8dfece65d178b77e85fd862df74a89`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

When `pm-check <worktree> --stop` ends a run of `tests/integration/run` while its checks run, the run's own emulator
container (`emuforge-it-<port>-<run id>`) is left running on the worktree's emulator port, and its key folder
`~/.aws/emulator/<port>/` stays. The next run on that worktree then refuses to start (`<folder> already exists; a
leftover would be mistaken for this run's files`), so every check is `error`, until someone removes the container
and the folder by hand. The run's two image names (`emuforge-it-product-<run id>`, `emuforge-it-emulator-<run id>`)
are left too.

A likely cause, not confirmed: `pm-check`'s `end_group` sends SIGTERM to the step's group and SIGKILL 10 seconds
later (`.pm/bin/pm-check`, `end_group`, `grace=10`), while the run's `cleanup` trap starts with
`docker stop -t 10 "$container"`, which alone may take 10 seconds, and then calls `docker rm`, `docker ps`,
`docker image rm`; the SIGKILL ends the trap before it gets there.

## Evidence

- Worktree `emuforge-293-h1` (emulator port 9320), 2026-11-17: its `pm-check` was stopped with `pm-check
  <worktree> --stop` at about 00:52 UTC during the `integration` step (`stopped pm-check pid 7347 (step
  integration)`).
- About 40 minutes later `docker ps` still listed `emuforge-it-9320-1794874321-10793 127.0.0.1:9320->9320/tcp`
  (`docker inspect`: created `2026-11-17T00:12:11Z`, label `emuforge-it-run=1794874321-10793`), and the images
  `emuforge-it-emulator-1794874321-10793` and `emuforge-it-product-1794874321-10793` were still tagged.
- The next `pm-check` of that worktree (commit `fdb6d8d`): step `integration` `error`, every check with the message
  `/Users/<user>/.aws/emulator/9320 already exists; a leftover would be mistaken for this run's files`
  (`emuforge-293-h1/output/logs/check-integration.log`, at that run).
- `pm-emulator-dir rm --worktree` refused (`in use: something accepts on 127.0.0.1:9320`) until the container was
  removed.

## Steps to Reproduce

1. In a worktree, start `pm-check <worktree>` and wait until `output/checks/running.json` names step `integration`
   and the run's line `integration: emulator ... answers on 127.0.0.1:<port>` is in `output/logs/check-integration.log`.
2. `pm-check <worktree> --stop`.
3. `docker ps --filter label=emuforge-it-run` and `ls ~/.aws/emulator/<port>` (do not read its files).

## Expected

After a stop, nothing of the run is left: no container with the run's label, no `~/.aws/emulator/<port>/` the run
made, neither of the run's two image names; the next run on the worktree starts as usual.

## Out of scope

- A SIGKILL to the run's group with no SIGTERM before it, which nothing in the harness sends.
- The product image build's bound (issue 293).
