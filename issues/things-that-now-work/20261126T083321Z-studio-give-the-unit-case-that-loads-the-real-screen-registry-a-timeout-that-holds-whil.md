Issue-Id: 658
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area-real-registry-unit-case|load-timeout
Issue-Check-Ids: studio-unit:src/test/area-preload.test.ts studio-unit:src/providers/aws/area/area-layout.test.tsx
Issue-Commit: d1b6ac21c6a387ae5986f355eee1a4971a1c228d

# Give the unit case that loads the real screen registry a timeout that holds while three unit suites run

> Identified against commit `d1b6ac21c6a387ae5986f355eee1a4971a1c228d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

One unit case of the AWS area, `studio/src/providers/aws/area/area-layout.test.tsx:686` ('on /aws with the real
build's registry: the description of "Services" is the registry's sentence …'), loads the real registry inside the
case with `vi.importActual('./screens')`, which imports every service's `screens.ts` and with them every service's
pages, and then renders the area's index, all under Vitest's default 5000 ms case timeout. The harness lets three
unit suites run at once across worktrees (owner, 2026-11-26). With three running, that import takes longer than the
case's timeout and the case fails, although nothing it asserts is wrong; with one suite running it passes. The
import grows with every service that gains screens, so the margin shrinks as the product grows. There is no second
run of a failed step (issue 569), so each such failure fails a unit's fast check. The reference is the same case
run alone on the same commit, which passes.

Issue 466 is the same class for other cases (those that wait for the area's lazy import first in their file); this
case is not among the ones it names and waits for a different load.

## Evidence

Four units of issue 71, cut from `feat/71` at `d1b6ac21c` and checked at the same time on 2026-11-26, each failed
`studio-unit` on this one case and passed every other test:

- `../emuforge-71-s3/output/logs/s3-registry-timeout.log` and `../emuforge-71-s3/output/logs/check-studio-unit.log`
  (head `977bec3e`, two runs): `FAIL src/providers/aws/area/area-layout.test.tsx > the AWS area from EmuForge (issue
  45) > on /aws with the real build's registry: …`, `Error: Test timed out in 5000ms.`, `❯
  src/providers/aws/area/area-layout.test.tsx:686:3`, `Tests 1 failed | 7250 passed (7251)`, `Duration 359.64s`.
- `../emuforge-71-s5/output/logs/check-studio-unit.log` (head `7b59aa03`): the same case, `Tests 1 failed | 7250
  passed (7251)`, `Duration 380.26s`.
- `../emuforge-71-s2/output/logs/check-studio-unit.log` (head `be345943`) and
  `../emuforge-71-s4/output/logs/check-studio-unit.log` (head `edff3be9`): `src/providers/aws/area/area-layout.test.tsx
  (146 tests | 1 failed)`, the same case.
- The same suite on `feat/71-s1`, whose head is the commit those four were cut from, run with no other unit of the
  issue checking: `../emuforge-71-s1/output/logs/check-studio-unit.log`, `Tests 7223 passed (7223)`, `Duration
  242.55s`.
- None of the four branches changes `area-layout.test.tsx`, `screens.ts` of the area or the area's layout.

## Steps to Reproduce

1. In three checkouts of the repository at once, run `bun run test:unit` in `studio/` (through `pm-test run vitest`,
   which admits three).
2. Read each run's result for `src/providers/aws/area/area-layout.test.tsx`.
3. The case at line 686 fails with "Test timed out in 5000ms" in runs that shared the machine; run alone, it passes.

## Expected

- The case at `area-layout.test.tsx:686` passes on every run of `studio-unit` while three unit suites run at once.
- The time the case allows itself does not depend on how many services have screens: adding a service's screens
  does not bring the case nearer its timeout.
- What the case asserts is unchanged: the registry's sentence in the description of "Services", the emulator line,
  and neither the notice nor "About the local emulator".

## Out of scope

- The cases issue 466 names, and Vitest's default timeout for every other case.
- How many unit suites the harness admits at once.
