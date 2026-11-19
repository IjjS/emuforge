Issue-Id: 540
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|studio-unit|three-worker-processes
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: c0ec6867a6d40fffe3ae5a236afa08592116c092

# Run Studio's unit tests on three worker processes

> Identified against commit `c0ec6867a6d40fffe3ae5a236afa08592116c092`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19: "3으로 해 알림이 너무 많다."

Studio's unit tests (`vitest run`, 123 test files, each in its own jsdom process) start as many worker processes as
the machine has cores, since `studio/vite.config.ts` sets no bound: 12 here. One run takes 35 to 45 s and all twelve
cores; two worker panes checking at once ask for 24, the machine stands at 100% CPU, `EVENT cpu` reaches the `pm`
each time, and checks that need Docker beside them fail on a busy machine. Measured on 2026-11-19 with three worker
processes and the module cache off, as `pm-check` runs them: 96 s, three cores.

Wanted: every run of Studio's unit tests uses at most three worker processes, whoever starts it (`pm-check`'s
`studio-unit` step, a worker's own `vitest run` of one file, the run on GitHub Actions): set in
`studio/vite.config.ts` (`test.maxWorkers: 3`, with a comment of one line saying why), not as an argument of one
caller. Nothing else of the test configuration changes. A Studio file is changed by this harness issue on the
owner's word. No test is added (issue 523); the engineer runs the step once and gives its duration.

## Evidence

`.pm/run/events.log`, the `EVENT cpu` lines of 2026-11-19; the measured run (96.16 s, `--maxWorkers=3 --fsModuleCache=false`, main at `c0ec686`).

## Steps to Reproduce

Run `pm-check` in two Studio worktrees at once and watch the CPU.

## Expected

Two or three checks at once fit the machine's cores.

## Out of scope
