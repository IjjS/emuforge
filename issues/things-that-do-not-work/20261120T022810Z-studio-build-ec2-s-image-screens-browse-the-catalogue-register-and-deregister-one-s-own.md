Issue-Id: 565
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.images|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Build EC2's image screens: browse the catalogue, register and deregister one's own

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Images are offered only as a choice of the launch form (issue 553); there is no screen to browse the catalogue or one's own images.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `DescribeImages` pages the 62 public images (filters `name`, `architecture`); `RegisterImage` and `DeregisterImage` work; `CreateImage` answers 501 NotImplemented. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of images with the name filter; register and deregister reach the emulator; "Create image from an instance" is shown as not implemented by the emulator, never hidden or faked.

## Out of scope

- Making `CreateImage` work (the emulator's).
