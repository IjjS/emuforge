Issue-Id: 625
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ec2.instance-list-unit|unhandled-transition
Issue-Check-Ids: studio-unit:src/providers/aws/area/services/ec2/pages/instance-list-page.test.tsx
Issue-Commit: b29fc6aa2a4d3d719d50e503a37306073af55401

# Resolve the unhandled transition error reported during the EC2 instance list unit suite

> Identified against commit `b29fc6aa2a4d3d719d50e503a37306073af55401`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The Ubuntu push run of the behind-main merge of #524 exited with one uncaught exception after all 6,036 Studio unit assertions passed. Vitest attributed the error to the EC2 instance list test file. The triggering case has yet to be isolated.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44848864321 selected every service because the push touched the shared pm-brief script. Its studio-unit step failed. See .pm/run/ci-b29fc6aa2.log lines 6473–6497: ReferenceError: window is not defined, from the transition timeout and React state update. The subsequent #580 push passed.

## Steps to Reproduce

1. Use the failing revision and the Studio setup in the Ubuntu main workflow.
2. Run the studio-unit step and inspect uncaught errors as well as assertion totals. The failure was observed once on CI.

## Expected

The EC2 instance list tests finish with their assertions intact and no uncaught transition callback error during suite shutdown.

## Out of scope

Changes to the other services selected by the workflow.
