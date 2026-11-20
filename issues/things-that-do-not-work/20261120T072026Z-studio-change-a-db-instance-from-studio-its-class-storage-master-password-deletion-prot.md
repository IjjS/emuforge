Issue-Id: 580
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.modify-instance|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Change a DB instance from Studio: its class, storage, master password, deletion protection and identifier

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot change a DB instance in Studio. Its page shows "Deletion protection" "On" with "Changed with ModifyDBInstance." and no way to turn it off, so a protected instance cannot be deleted from Studio; a master password typed wrongly at creation cannot be set again.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `ModifyDBInstance` answers for the class, the storage, the master password, deletion protection and a new identifier; the status reads `modifying`, then `available`. The critique of issue 573 named the missing way forward under the protection (`.pm/archive/573/` `review-final.md`, P3). The requirement of issue 573 lists this as task 6 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 403 planned this the old way; this issue takes its place for the task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- From a DB instance's page: change its class, storage, master password and deletion protection, and rename it; each reaches the emulator, and the page follows `modifying` to `available`.
- With the protection turned off in Studio, "Delete" becomes available.

## Out of scope

- A DB cluster's changes (the cluster's actions).
- The values `CreateDBInstance` accepts unchecked.
