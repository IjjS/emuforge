Issue-Id: 660
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area.area-layout-test|registry-import-deadline
Issue-Check-Ids:
Issue-Commit: ed8f53eabec6c564c992b80b44b52b48defa6db7

# Keep the area's real-registry test from timing out when Vitest runs share the machine

> Identified against commit `ed8f53eabec6c564c992b80b44b52b48defa6db7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

One case of `studio/src/providers/aws/area/area-layout.test.tsx` (line 686, "on /aws with the real build's registry:
the description of "Services" is the registry's sentence…") imports the real screen registry with
`vi.importActual('./screens')`, which loads every service's `screens.ts` and what they import, inside the case
itself and under Vitest's default deadline of 5 seconds. While other Vitest runs share the machine (the harness
admits three at once) the import alone takes longer than that, and the case fails with "Test timed out in 5000ms"
although nothing it asserts is wrong. The registry grows with every service that gets screens, so the case fails
more often with each one. It fails the fast check of units that changed nothing it reads.

## Evidence

The same case, the only shared failure, in the fast checks of units of two issues on 2026-11-26 (worktree logs, not
tracked): `emuforge-69-s13/output/logs/check-studio-unit-first-complete.log` (1 failed, 7264 passed; record
`emuforge-69-s13/output/checks/2026-11-26T175048.json`) and again on an unchanged second run
(`emuforge-69-s13/output/logs/check-studio-unit.log`); `emuforge-69-s9/output/logs/check-studio-unit.log`;
`emuforge-69-s2/output/logs/check-studio-unit.log`; `emuforge-71-s3/output/logs/check-studio-unit.log` and
`emuforge-71-s4/output/logs/check-studio-unit.log`. Each: `FAIL src/providers/aws/area/area-layout.test.tsx > the
AWS area from EmuForge (issue 45) > on /aws with the real build's registry … Error: Test timed out in 5000ms.`
The unit `s1` of issue 69 passed the same case on the same code when it ran alone.

## Steps to Reproduce

1. In three worktrees at once, run `bun run test:unit` in `studio/` (each through `pm-test run vitest`).
2. In at least one of them the case at `area-layout.test.tsx:686` fails with "Test timed out in 5000ms"; run alone,
   it passes.

## Expected

- The case passes whether one or three Vitest runs share the machine, with the registry of every service that has
  screens.
- What it asserts is unchanged: the sentence of "Services" from the real registry, the emulator line, no notice.
- The time the registry takes to load is not counted against the deadline of an assertion about what is shown.

## Out of scope

The number of Vitest runs the harness admits at once, and the deadlines of other cases.
