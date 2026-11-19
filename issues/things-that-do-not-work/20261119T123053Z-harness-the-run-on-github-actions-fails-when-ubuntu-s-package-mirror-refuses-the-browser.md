Issue-Id: 522
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|ci|chromium-install-fails-when-ubuntu-mirror-answers-503
Issue-Check-Ids:
Issue-Commit: 94d90c2b6021d896e4e3a95943eabe49e47cb6ea

# The run on GitHub Actions fails when Ubuntu's package mirror refuses the browser's system packages

> Identified against commit `94d90c2b6021d896e4e3a95943eabe49e47cb6ea`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main.yml` for the push of `3e91a3f` (issue 512) failed. Its step `chromium` installs the browser with its
system packages; `security.ubuntu.com` answered `503 Service Unavailable` for the font and Mesa packages for four
minutes and the installation exited 100. With no browser the steps after it failed too (`engine-test (second run)`,
`integration (second run)`). Nothing of the pushed change is named by a failing line. The fault is outside the
repository; whether the workflow should try the installation again, cache the packages or use an image that holds
them is the owner's to decide.

Filed from a run on GitHub Actions: it waits for the owner's signal.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44522101199 ; the failed steps' log `.pm/run/ci-3e91a3f.log` (`E: Failed to fetch https://security.ubuntu.com/… 503 Service Unavailable`).

## Steps to Reproduce

Not at will: it needs the mirror to refuse.

## Expected

A refusal of the package mirror for some minutes does not fail the run of a push.

## Out of scope
