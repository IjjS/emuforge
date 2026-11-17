Issue-Id: 437
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|product-form|windows-powershell
Issue-Check-Ids: engine.product-start-connects-to-its-own-emulator engine.product-start-without-home-leaves-nothing-on-the-host engine.product-start-has-one-unpublished-emulator engine.product-stop-leaves-only-the-volume-and-a-users-emulator-untouched engine.product-start-says-when-the-emulator-did-not-come-up engine.product-repeated-start-with-the-variable-keeps-the-containers engine.product-relay-signs-a-made-up-key-with-the-emulators-key engine.product-tracked-files-are-lf-in-every-checkout
Issue-Commit: 6acea5285d981b812a09bdd9ce6e7b4ac9794d58

# Make the product form start from PowerShell on Docker Desktop for Windows, without WSL

> Identified against commit `6acea5285d981b812a09bdd9ce6e7b4ac9794d58`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The product form was verified on Docker Desktop for macOS and, with issues 54 and 55, on Docker Engine on Linux.
It has never been started on Windows. The owner's word (2026-11-17): a Windows user must not be told to use WSL;
`docker compose up -d --build` typed in PowerShell at the root of a clone has to work.

What is expected to stop it, from reading the files (none of it was run on Windows):

- No `.gitattributes`: Git for Windows checks text out with CRLF by default, and files that are copied into an
  image or read by a program in a container then hold CRLF: the emulator image's entrypoint script (issue 55),
  `infra/emuforge/haproxy.cfg`, any shell script.
- `docker-compose.yml` mounts `${HOME}/.aws/emulator`. PowerShell and cmd have no `HOME`, only `USERPROFILE`;
  Compose substitutes an empty text and mounts `/.aws/emulator`.
- The wrapper `./compose` (issue 54) is a bash script and uses `id -u` and `uname -s`.
- Not known: whether the engine's container can read the files the emulator's container writes with mode
  `0600` through a mount of a Windows folder.

What the requirement has to settle:

- The plain commands of the README's "Start" (situations 3 and 4) work from PowerShell and from cmd.
- Whether the wrapper gets a PowerShell counterpart or the README names the plain commands for Windows. One
  logic kept twice is a cost; say which and why.
- How this is verified. A GitHub Actions Windows runner runs Windows containers by default and is not Docker
  Desktop; the owner may have a Windows machine. Without a run on Windows the issue is not closed: say so.

## Evidence

```
$ git ls-files | grep -i gitattributes        # nothing
$ grep -n 'HOME' docker-compose.yml           # source: ${HOME}/.aws/emulator
```

The README's "Start" names Docker Desktop for macOS and Docker Engine on Linux only.

## Steps to Reproduce

1. On Windows with Docker Desktop, clone the repository with Git for Windows' default settings.
2. In PowerShell at the root of the clone: `docker compose --profile emulator up -d --build`.
3. Expected from the files, not observed: the emulator's container does not start (its entrypoint holds CRLF),
   or EmuForge shows the emulator as not connected (the mount is not the user's folder).

## Expected

- From PowerShell on Docker Desktop for Windows, the README's start and stop commands bring EmuForge up and
  down, with and without an emulator already running, and Studio shows the emulator connected.
- A clone made with Git for Windows' default settings holds LF in every file a container reads.
- Nothing a user of macOS or Linux types changes.
- The README says what was verified on Windows and how.
- No key leaves the emulator's folder; the mount stays read-only; every port stays on `127.0.0.1`.

## Out of scope

- Running the engine or Studio outside a container on Windows.
- Rancher Desktop, Colima, OrbStack, Podman and containerd with nerdctl.
- A native emulator on Windows (the emulator ships a Linux package only).
