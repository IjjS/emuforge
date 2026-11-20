Issue-Id: 581
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.subnet-groups|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Build RDS's DB subnet group screens: see them, create one from subnets, delete one

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create or delete a DB subnet group in Studio; the create forms offer the groups the emulator holds, which today is `default` alone unless code made another.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `DescribeDBSubnetGroups`, `CreateDBSubnetGroup` and `DeleteDBSubnetGroup` answer; the delete is refused for `default` and for a group in use; the quota is 50 groups; the subnets are EC2's `DescribeSubnets`. The requirement of issue 573 lists this as task 7 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 409 planned this the old way; this issue takes its place for the task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of the DB subnet groups with each one's VPC and subnets; create one from chosen subnets and delete one, each reaching the emulator.
- The emulator's refusal for `default` and for a group in use is shown as it came, or the action is unavailable with the reason.

## Out of scope

- VPC's own subnets screens (issue 574).
