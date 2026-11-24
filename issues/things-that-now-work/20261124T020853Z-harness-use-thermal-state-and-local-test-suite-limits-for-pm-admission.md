Issue-Id: 640
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|local-test-admission|thermal-and-suite-slots
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 34bb4e22c4b99aec4f70c70a075dc6f498038415

# Use thermal state and local test suite limits for PM admission

> Identified against commit `34bb4e22c4b99aec4f70c70a075dc6f498038415`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Use macOS thermal state to govern PM heat response and cap only concurrent local test suites. Owner authorized a direct merge without testing for this change.

## Evidence

Existing admission uses CPU percentage greater than 90. Vitest is configured at 3 workers per invocation and integration Playwright has 1 worker. Local panes and PM use the main checkout harness across worktrees.

## Steps to Reproduce

Inspect local pm-check suite launches (including focused checks), the watch daemon, direct pane test commands, and the PM event instructions.

## Expected

Across the project allow at most three simultaneous Vitest invocations and one integration suite. Wait only for the affected suite; preserve existing Vitest worker count and unrelated runner and pane settings. Use shared admission for direct and pm-check launches, with interruption-safe accounting and adoption of already-running checks. Treat CPU as informational; preserve memory protection. At nominal/fair proceed, at serious defer new tests and at critical reduce active heavy work safely through PM. Make the main-checkout entry points and rollout behavior clear. Owner explicitly waived tests and requests immediate merge. Syntax and entry-point inspection only.

## Out of scope

No VM, #639 rollout, CI changes, per-pane core budget or new test suite.
