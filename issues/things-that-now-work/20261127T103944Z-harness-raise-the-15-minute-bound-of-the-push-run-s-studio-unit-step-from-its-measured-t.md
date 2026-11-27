Issue-Id: 690
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|push-studio-unit-time-bound|15min-timeout
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 0254c58eb7df895a6db2e0d01124c8398d3317b7

# Raise the 15-minute bound of the push run's studio-unit step from its measured times

> Identified against commit `0254c58eb7df895a6db2e0d01124c8398d3317b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The push run of `0254c58e` failed: its step `studio-unit` was stopped by its own bound, "The action 'studio-unit' has
timed out after 15 minutes", with no test reported failed before it. The push carried a merge made behind `main`
(issue 687's closing commit, behind by 8 harness paths), which moved one issue file and changed no Studio file. The
same step, on the same Studio tree, took 806 s in the run before it; the bound of 900 s leaves no room for the
variance of a hosted runner, and four issues about to merge add unit tests.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/45978884774 (failed; services selected: none of a service, the push
changed an issue file only; log `.pm/run/ci-0254c58eb.log`, last line the timeout). `studio-unit` in the earlier push
runs of 2026-11-27, from the steps' timestamps: 595 s (45864678953), 660 s (45889436187), 670 s (45919717905), 637 s
(45927064359), 806 s (45976016323, the same Studio tree as the failed run; the two runs overlapped in time).
`.github/workflows/main.yml` line 157: `timeout-minutes: 15`. `.github/workflows/full.yml` runs the same suite; its
bound for that step has not been compared.

## Steps to Reproduce

1. Read the step `studio-unit` of the runs above with `gh run view <id> --json jobs`.
2. Compare the times with the step's `timeout-minutes` in `.github/workflows/main.yml`.

## Expected

The step's bound in `main.yml`, and in `full.yml` if it is as tight there, is at least twice the longest measured
time, and the job's bound still holds the sum of its steps' bounds as the workflow's comment states it. The next
push run of `main` is the evidence.

## Out of scope

Making the suite faster, the number of Vitest workers on the runner, the integration step's bound (issue 634).
