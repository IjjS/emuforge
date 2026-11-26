Issue-Id: 639
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|pm-local-cpu|five-panes-two-workers
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: e373ef54b8556fff03d08d8003d188d8dbbb7782

# Limit local PM work to five panes and a ten-core budget with two workers per pane

> Identified against commit `e373ef54b8556fff03d08d8003d188d8dbbb7782`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner requires local EmuForge PM workloads to use at most five panes, two CPU-heavy workers per pane (including Vitest and Jest), and a shared ten-core execution budget. The PM manages the limits. Apply across concurrent starts, resumed worktrees and direct pane runner invocations. Scope is local project workloads.

## Evidence

On the 12-logical-CPU host, eight panes were registered and two simultaneous Studio Vitest suites ran with a configured three workers each. The pane admission limit was 24. Both suites and all panes were stopped at owner request.

## Steps to Reproduce

Inspect pane admission, open-check resource accounting and the effective runner options in the Studio fast check and worktree direct invocations.

## Expected

Local admissions cannot exceed five even under races. Permit at most two parallel workers in a pane across supported heavy runners, including subprocesses launched by checks; account for independent PM checks in the overall budget. Verify limits in normal paths and expose the effective values to PM. State the distinction between job parallelism and OS CPU usage, and demonstrate what bounds actual usage on this macOS host. Resume preserved work under the enforced limits.

## Out of scope

Machine-wide throttling of unrelated applications, edits to unrelated user jobs, and changes to hosted CI concurrency.
