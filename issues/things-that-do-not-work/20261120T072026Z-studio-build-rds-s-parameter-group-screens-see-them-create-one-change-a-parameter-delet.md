Issue-Id: 582
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.parameter-groups|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Build RDS's parameter group screens: see them, create one, change a parameter, delete one

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create, change or delete a DB parameter group or a DB cluster parameter group in Studio.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `DescribeDBParameterGroups`, `CreateDBParameterGroup`, `DescribeDBParameters` (22 parameters for `postgres18`), `ModifyDBParameterGroup` and `DeleteDBParameterGroup` answer, and the cluster's five; whether a changed parameter changes the database was not found. The requirement of issue 573 lists this as task 8 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 410 planned this the old way; this issue takes its place for the task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of the parameter groups, a group's parameters, create a group, change a parameter and delete a group, each reaching the emulator.
- The screen claims no effect on the database that a check cannot show.

## Out of scope

- Option groups.
