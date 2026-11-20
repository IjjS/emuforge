Issue-Id: 579
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.snapshots|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Build RDS's DB snapshot screens: take one of a DB instance, restore it to a new instance, delete it

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, take, restore or delete a DB snapshot in Studio.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `CreateDBSnapshot`, `DescribeDBSnapshots`, `RestoreDBInstanceFromDBSnapshot` and `DeleteDBSnapshot` answer; a snapshot restored to a new DB instance holds the rows the database had when it was taken, and not a row added after; `DeleteDBInstance` with `FinalDBSnapshotIdentifier` makes a manual snapshot of that name; the quota is 100 manual snapshots. The requirement of issue 573 lists this as task 5 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 408 planned snapshots the old way; this issue takes its place for the task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of the DB snapshots; take one of a DB instance, restore one to a new DB instance and delete one, each reaching the emulator.
- A DB instance deleted with a final snapshot leaves that snapshot in the list.

## Out of scope

- DB cluster snapshots (the cluster's actions, a task of their own).
- Read replicas, exports and shared snapshots.
