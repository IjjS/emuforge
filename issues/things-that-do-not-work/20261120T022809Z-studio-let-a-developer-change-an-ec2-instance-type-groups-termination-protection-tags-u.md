Issue-Id: 561
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.instance-change|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Let a developer change an EC2 instance: type, groups, termination protection, tags, user data

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

An instance's page (issue 553) is read-only but for its state: its type, security groups, termination protection, tags and user data cannot be changed in Studio.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `ModifyInstanceAttribute` changes the type while stopped (`IncorrectInstanceState` "… is not in the 'stopped' state." while running), replaces the groups, and sets `disableApiTermination` (enforced: `OperationNotPermitted` on terminate); `disableApiStop` is accepted and not enforced. `CreateTags`/`DeleteTags` work (`aws:` keys refused with `InvalidParameterValue`). The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- Each change is made from the instance's page, reaches the emulator, and a refusal is shown as it came.

## Out of scope

- Stop protection (the emulator does not enforce it).
