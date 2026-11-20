Issue-Id: 585
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.events|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Show the events of a DB instance and a DB cluster

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot read RDS's events in Studio.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `DescribeEvents` answers, with one event per creation. The requirement of issue 573 lists this as task 11 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issues 412 (events) and 405 (an instance's further tabs) planned this the old way; this issue takes their place for the task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- The events of a DB instance and of a DB cluster, newest first, as the emulator reports them, with an empty state when there is none.

## Out of scope

- Event subscriptions (no task of the list).
