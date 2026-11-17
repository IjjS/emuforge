Issue-Id: 465
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|product-form|windows-run
Issue-Check-Ids:
Issue-Commit: 3a6ee5358eff11d94a03776b1b2db738cd4e6de2

# Say in the README what was run on Windows once the owner has run the product form there

> Identified against commit `3a6ee5358eff11d94a03776b1b2db738cd4e6de2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 437 made the product form one form on every platform (its own emulator, a Docker volume, nothing on the
host) and closed on its checks, which run on macOS and on the Ubuntu runner. On Windows it was not run: the
README's "Start" says "On Windows it was not run yet."

The owner runs it on Windows after 2026-11-19: Rancher Desktop with dockerd (moby), from PowerShell, the plain
start and stop lines of the README. That run is where the form failed before issue 437 (the emulator's
entrypoint found the mounted Windows folder owned by root and not writable, and exited).

This issue waits for that run. Then one unit changes the README's sentence to what was run (runtime, version,
date, which lines, what was not run: Docker Desktop for Windows, cmd), and anything the run shows that does not
work is filed as its own issue with the output as evidence.

## Evidence

`README.md`, "Start", on `main` at `3a6ee53`. The decisions of issue 437 are in `.pm/archive/437/decisions.md`
(main checkout).

## Steps to Reproduce

1. On Windows with Rancher Desktop (dockerd), in PowerShell at the root of a clone of `main`:
   `docker compose up -d --build`, open http://127.0.0.1:8296/, then `docker compose down`.

## Expected

- The owner's output of that run is recorded in this issue's `decisions.md` by the `pm`.
- The README states what was run on Windows, by whom and when, and what was not.

## Out of scope

- Making anything work that the run shows broken: each is its own issue.
