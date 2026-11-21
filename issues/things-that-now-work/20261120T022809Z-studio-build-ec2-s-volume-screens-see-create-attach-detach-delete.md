Issue-Id: 559
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.volumes|not-built
Issue-Check-Ids: 559
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Build EC2's volume screens: see, create, attach, detach, delete

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see or manage EBS volumes in Studio. EC2's screens (issue 553) show an instance's volumes as rows on its page only.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `DescribeVolumes`, `CreateVolume` (1 to 16384 GiB, the zone required and checked), `AttachVolume` (`VolumeInUse`, `InvalidVolume.ZoneMismatch`, `IncorrectInstanceState` for a terminated instance), `DetachVolume` (the root too), `DeleteVolume` (`VolumeInUse` while attached) and `ModifyVolume` all answer. A terminated instance's volumes stay listed `in-use`. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of volumes and a volume's page; create, attach to an instance, detach and delete reach the emulator, and its refusals are shown as they came.

## Out of scope

- Snapshots (their own issue).
