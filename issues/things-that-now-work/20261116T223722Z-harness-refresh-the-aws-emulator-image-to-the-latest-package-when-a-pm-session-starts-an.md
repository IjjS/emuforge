Issue-Id: 68
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|emulator-image|refresh-at-session-start
Issue-Check-Ids: harness.emulator-image harness.check-emulator harness.emulator-image-docs harness.integration-image
Issue-Commit: fe28fb4faecc4a824bf214f5b547ac759ca7f7aa

# Refresh the aws-emulator image to the latest package when a PM session starts, and record its version

> Identified against commit `fe28fb4faecc4a824bf214f5b547ac759ca7f7aa`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The emulator image `aws-emulator` is built from `infra/aws-emulator/Dockerfile`, which installs the package's
`LTS/latest` at build time. Docker keeps the layer, so a machine stays on the version it first built: this
machine ran 1.0.364 while the GitHub Actions runner, which has no cache, ran 1.0.385 and then 1.0.471 within
two days. A check then passes locally and fails only after `main` is pushed (issue 67).

The owner's decision (2026-11-17): the local image follows the latest package, refreshed at a defined moment and
not in the middle of a check run. That moment is the start of a PM session. One script under `.pm/bin/` does it,
and the PM skill's session start names it.

What the script has to settle, for the requirement to say:

- It rebuilds the image so that the package is fetched again, in the background, without holding the session
  start, and says in one line what it did: the version before, the version after, or why it could not (Docker
  not answering, no network). A failed refresh leaves the image as it was.
- It never starts, stops or recreates a container, the owner's emulator on its port least of all. A run of the
  integration checks already tags its own copy of the image when it starts, so a run in flight keeps the version
  it started with.
- The version in use is recorded where a failure is read: in each `pm-check` record and in the workflow's log
  on GitHub Actions, so that a red check can be told from an emulator change in one line.
- When the refresh changes the version, the PM is told, because the skill already says to run the full checks
  on `main` then.
- Worktrees share the one image name. A unit that changes the Dockerfile (issue 55 did) rebuilds the same tag
  from its worktree while other units' checks use it. Whether the refresh, a worktree's build and the checks need
  separate names is part of this issue.

## Evidence

```
$ docker run --rm --entrypoint aws-emulator aws-emulator --version      # this machine, 2026-11-16: 1.0.364
```

The run of `main` at `65023c6` on GitHub Actions used 1.0.471 and failed `engine.relay-stays-on-loopback`
(issue 67); the run before it used 1.0.385 and passed. Both built the same Dockerfile.

## Steps to Reproduce

1. Build the image once; wait until the package has a newer release.
2. Start a PM session and run the checks: the image is still the old version, with nothing saying so.

## Expected

- Starting a PM session brings the image to the latest package without delaying the session, and one line
  states the versions.
- A check record and a workflow log name the emulator version they ran against.
- No container is touched; a failed refresh changes nothing.
- The rule sentences for the PM skill are shown to the owner before they merge.

## Out of scope

- The wrapper `./compose` of issue 54 preparing the image for a user: its own issue once 54 is merged.
- Pinning the package to a named version.
