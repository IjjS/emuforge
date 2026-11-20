Issue-Id: 562
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.snapshots|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Build EC2's snapshot screens: create one of a volume, delete it

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create or delete EBS snapshots in Studio.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `CreateSnapshot`, `DescribeSnapshots` (own ones by `--owner-ids self`; 60 public ones without) and `DeleteSnapshot` answer. `CreateVolume` from one's own snapshot answers 400 `InvalidSnapshot.NotFound`. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of one's own snapshots; create from a volume and delete reach the emulator.

## Out of scope

- A volume made from a snapshot (the emulator refuses it).
