Issue-Id: 603
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|integration.cloudscape-readers|copied-per-service
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Lift the Cloudscape readers that each service's integration support copies into the shared support

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration checks of a service's screens read tables, key-value pairs, flashes, dialogs, form fields and selects through helpers kept in that service's own support file. A service folder may not import another's, so issue 574's `tests/integration/studio/services/vpc/vpc.ts` holds a copy of the generic part of `services/ec2/ec2.ts` (the XML and direct-call helpers and the readers `open`, `rowsOf`, `expectRows`, `expectCell`, `selectRow`, `findBy`, `emptyOf`, `valueOf`, `expectFlash`, `dialogOf`, `confirmWith`, `field`, `errorOf`, `chooseOption`, `selectOf`, `tableOf` and others). A fix to one copy does not reach the other, and the next service copies them again. The pattern elsewhere: what two services need lives in `tests/integration/studio/support/`.

## Evidence

`tests/integration/studio/services/vpc/vpc.ts` on `feat/574` against `tests/integration/studio/services/ec2/ec2.ts` on `main`: the helper bodies named above are the same text in both (the VPC file was made by copying lines 24-168, 691-920 and 974-1058 of the EC2 file). VPC's copy also gained `findOnly`, which waits for the list's name filter before a selection; EC2's copy has no such wait.

## Steps to Reproduce

1. Compare the two files named above: `diff <(sed -n '691,920p' tests/integration/studio/services/ec2/ec2.ts) tests/integration/studio/services/vpc/vpc.ts | head`.
2. The readers are in both.

## Expected

- The readers and the direct EC2 query helpers are in one module under `tests/integration/studio/support/`, imported by both services' support files; no reader body is in two files.
- Every `studio.ec2-…` and `studio.vpc-…` check passes unchanged.

## Out of scope

- Any change to what a check asserts.
