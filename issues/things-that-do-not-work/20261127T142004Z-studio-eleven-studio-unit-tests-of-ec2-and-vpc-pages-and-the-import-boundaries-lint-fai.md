Issue-Id: 696
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|unit-tests-slow-runner|ec2-vpc-pages-and-import-boundaries
Issue-Check-Ids: studio-unit:src/providers/aws/area/services/ec2/pages/add-rule-page.test.tsx studio-unit:src/test/import-boundaries.test.ts
Issue-Commit: 824ab29a93b8cd8c32b8152eecc99fa1d88cd12c

# Eleven Studio unit tests of EC2 and VPC pages and the import-boundaries lint fail on a slow push runner

> Identified against commit `824ab29a93b8cd8c32b8152eecc99fa1d88cd12c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The push run of `91870701` (issue 691's merge) failed its step `studio-unit`: 7 of 526 test files, 11 tests. Ten
are `TestingLibraryElementError: Unable to find an element with the text …` in pages of EC2 and VPC that wait for
what a submit leads to (a flash such as "Added an inbound rule to web"), and one is `src/test/import-boundaries.test.ts`,
"Test timed out in 60000ms". Issue 691 changed API Gateway files only, and the same tests passed in the push run
before it (`2cc607f1`, `studio-unit` 656 s) on the same EC2 and VPC sources; this run's suite took 1000 s. So the
failures look like waits that a slower runner outruns, not like a change of behaviour; that has not been shown by
running them under load.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/46009627860 (failed on `studio-unit` only; integration passed, with
issue 691's check). Log `.pm/run/ci-91870701a.log`: "Test Files 7 failed | 519 passed (526)", "Duration 1000.46s".
Failed: `ec2/pages/add-rule-page.test.tsx` (3), `ec2/pages/create-group-page.test.tsx` (1),
`ec2/pages/launch-instance-page.test.tsx` (2), `vpc/pages/attach-gateway-page.test.tsx` (2),
`vpc/pages/create-gateway-page.test.tsx` (1), `vpc/pages/vpc-page.test.tsx` (1), `src/test/import-boundaries.test.ts`
(1, the 60 s bound of "every file … linted as it is"). The run before:
https://github.com/IjjS/emuforge/actions/runs/45991664536 (`studio-unit` passed in 656 s).

## Steps to Reproduce

1. Read the failed tests of the run above.
2. Run the seven files with the machine under load (for example beside two other Vitest runs) and compare.

## Expected

The cause of each of the two kinds is found (a wait bound by the library's default second, the lint case's 60 s),
and the tests pass on a runner as slow as the one of this run without weakening what they assert.

## Out of scope

The step's bound in the workflow (issue 690), making the suite faster.
