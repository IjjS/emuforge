Issue-Id: 583
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.cluster-actions|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Add a DB cluster's actions: stop, start, fail over, change, snapshot and restore

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot stop, start, fail over or change a DB cluster in Studio. An Aurora DB instance's "Start" and "Stop" are unavailable with "An Aurora DB instance starts and stops only with its DB cluster.", and the cluster's page offers neither, so an Aurora database cannot be stopped from Studio; a cluster's "Deletion protection" "On" reads "Changed with ModifyDBCluster." with no way to turn it off.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `StopDBCluster` and `StartDBCluster` answer and the members follow; `FailoverDBCluster` changes the writer; `ModifyDBCluster` answers; `CreateDBClusterSnapshot` and `RestoreDBClusterFromSnapshot` were not probed. The check `studio.rds-clusters-made-elsewhere-are-shown` shows the stop and start with direct calls. The critique of issue 573 named the reason that points to a page without the action (`review-final-r2.md`, P3). The requirement of issue 573 lists this as task 9 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 406 planned the clusters the old way; what issue 573 left of it is this task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- From a DB cluster's page: stop, start, fail over and change it (deletion protection among the changes), each reaching the emulator, the page and its members following the statuses.
- The Aurora reason on a member's page leads to where the cluster is stopped and started.
- DB cluster snapshots: what the emulator answers is found first by calling it; take, restore and delete as far as it supports them.

## Out of scope

- Global clusters and Multi-AZ DB clusters' own actions.
