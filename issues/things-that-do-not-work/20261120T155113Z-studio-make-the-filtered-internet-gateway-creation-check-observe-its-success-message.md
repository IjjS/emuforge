Issue-Id: 623
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|vpc.create-gateway-filtered-return|missing-success-in-unit-check
Issue-Check-Ids:
Issue-Commit: 4f41c5cf821708e0961d2fc347eef6133f463650

# Make the filtered internet gateway creation check observe its success message

> Identified against commit `4f41c5cf821708e0961d2fc347eef6133f463650`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The VPC Create internet gateway unit case with a VPC filter intermittently fails while waiting for the success message after submission. The reference is the existing confirmed behavior: the filtered gateway list opens and displays the created gateway's identifier in its success message.

## Evidence

The whole check of issue 524 on 4f41c5cf failed at studio/src/providers/aws/area/services/vpc/pages/create-gateway-page.test.tsx:302 while waiting for “Created internet gateway igw-0new”. The test took 1380 ms. See ../emuforge-524/output/logs/whole-retry-studio-unit-4f41c5cf.log and ../emuforge-524/output/checks/whole-retry-4f41c5cf.json. The VPC implementation and its tests were unchanged on this branch. Its preceding whole-check attempt passed the Studio unit suite on the same commit.

## Steps to Reproduce

1. Run pm-check in the issue worktree under concurrent check load.
2. Inspect the Studio unit result for “opened with ?vpc=”, in create-gateway-page.test.tsx.

## Expected

After creating a gateway from the filtered form, the check observes the created gateway's success message and verifies the return to the list with the original filter.

## Out of scope

Lambda monitoring and changes to the confirmed VPC behavior.
