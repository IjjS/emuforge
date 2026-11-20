Issue-Id: 584
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.tags|not-built
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Add and remove the tags of a DB instance, a DB cluster or a snapshot

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer can read the tags of a DB instance and a DB cluster in Studio but cannot add, change or remove one.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): `AddTagsToResource`, `RemoveTagsFromResource` and `ListTagsForResource` answer. The requirement of issue 573 lists this as task 10 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issue 405 planned an instance's further tabs the old way; its tags are this task.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- On a DB instance's and a DB cluster's page: add a tag, change its value and remove it, each reaching the emulator; the "Tags" section follows without a refresh.

## Out of scope

- Tags at creation in the create forms.
- A snapshot's tags until snapshots have a screen.
