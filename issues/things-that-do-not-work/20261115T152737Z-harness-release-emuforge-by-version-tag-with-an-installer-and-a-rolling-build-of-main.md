Issue-Id: 35
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|release|version-tags-and-installer
Issue-Check-Ids:
Issue-Commit: c07d3006627d385f454897f665ff1cf54ce0c66e

# Release EmuForge by version tag with an installer and a rolling build of main

> Identified against commit `c07d3006627d385f454897f665ff1cf54ce0c66e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

EmuForge has no releases. There is no version, no tag, nothing built by a machine other than a developer's, and
no way to install it without cloning the repository. The owner wants:

- Releases by version tag on GitHub, starting at `v0.1.0` once Studio and the engine are complete enough; the
  owner says when.
- An install by one shell command for a released version, in two forms: for a user who already runs an
  aws-emulator, and for a user who has none (README situations 1 and 2 of issue #34).
- A way to see what `main` holds without building it by hand: a rolling build of `main` that the product-form
  start of issue #34 can pull instead of building.

Order: after issue #34, which makes the images and the Compose start this issue publishes. This issue does not
start until the owner says so.

Decisions that are the owner's and are asked for at the requirement stage, with the plan's recommendation:

- Where images are published (for example GitHub's container registry) and under which names and tags
  (`vX.Y.Z`, a moving tag for the newest release, a moving tag for `main`).
- Whether a GitHub Actions workflow builds and publishes on a tag and on each push to `main`. Root `AGENTS.md`
  lets the harness write nothing to GitHub but `main` without the owner's word; a workflow file and anything it
  publishes need that word.
- What a release contains besides images (engine binaries per platform, a Studio bundle, checksums) and which
  platforms.
- How the version is kept in one place (`engine/Cargo.toml`, `studio/package.json`) and who bumps it.
- What the installer does and does not do on the user's machine (it never reads `~/.aws/credentials` or
  `~/.aws/config`, never starts or stops an emulator it did not start).

Reference: none.

## Evidence

```
$ git tag | wc -l
0
$ ls .github
ISSUE_TEMPLATE
```

No tag exists and the repository has no workflow.

## Steps to Reproduce

1. Look for a released version of EmuForge on GitHub: there is none.
2. Look for a way to run the newest `main` without building it: there is none.

## Expected

- Pushing a tag `vX.Y.Z` on `main` produces a release: the images of issue #34 under that version, and the
  release's other contents as decided, built from that commit with its checks passing.
- Each push to `main` produces the rolling build under a moving tag; the product-form start can use it instead
  of building locally, and says which commit it runs.
- One shell command installs and starts a released version, with and without an emulator already running; it
  is safe to read before running, verifies what it downloads, and can remove what it installed.
- `README.md` situations 1 and 2 hold their commands, and a "Releases" part says how a version is cut.
- The harness's own rules say when the `pm` tags and what it never does without the owner (the owner writes
  those rules).

## Out of scope

- The images and the Compose start themselves: issue #34.
- The CLI's own distribution (situations 5 and 6).
- Package managers (Homebrew and the like).
