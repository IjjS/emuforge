Issue-Id: 687
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|unit-test-environment|happy-dom
Issue-Check-Ids:
Issue-Commit: 1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f

# Measure Studio's unit tests on happy-dom and move to it if they hold

> Identified against commit `1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner asked for this on 2026-11-27. Studio's unit tests run in `jsdom` (`studio/vite.config.ts`), each test file
in its own process, three workers at most; the suite of 522 test files takes about seven minutes in a check.
`happy-dom` is commonly faster as a test environment. Whether Studio's tests, which render Cloudscape components
and assert through their test wrappers, pass on it is not known.

Measure first: run the whole suite once on `happy-dom` and report its time and every failing test beside the same
run on `jsdom`. Move the suite to `happy-dom` only if what fails is small and each failure is a difference of the
environment that can be answered without weakening an assertion.

## Evidence

`studio-unit` took 447.1 s, 420.6 s, 433.2 s and 428.4 s in four unit checks on 2026-11-27 (`output/checks/last.json`
of the worktrees `emuforge-75-s9`, `emuforge-70-s5`, `emuforge-75-s8`, `emuforge-664-s4`). No run on `happy-dom`
has been made.

## Steps to Reproduce

1. `cd studio && bun run test:unit` and read the duration.
2. The same with the environment set to `happy-dom`.

## Expected

- A measurement on one machine state: both environments' whole-suite time and the list of tests that fail on
  `happy-dom` only, with the cause of each kind.
- If the move holds: the suite runs on `happy-dom`, every test passes with no assertion weakened or removed, and
  the suite's time in `pm-check` is stated before and after.
- If it does not hold: nothing changes but the record of the measurement and why, and the issue is closed on that.

## Out of scope

Which tests a fast check runs (issue 686), turning off file isolation, the integration tests.
