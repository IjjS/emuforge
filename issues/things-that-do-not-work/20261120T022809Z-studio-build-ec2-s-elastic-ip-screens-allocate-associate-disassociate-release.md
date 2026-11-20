Issue-Id: 560
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.elastic-ips|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Build EC2's Elastic IP screens: allocate, associate, disassociate, release

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot manage Elastic IPs in Studio.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `AllocateAddress`, `AssociateAddress` (the instance's public IP becomes it), `DisassociateAddress` (the instance then has no public IP) and `ReleaseAddress` (`InvalidIPAddress.InUse` while associated) all answer; `DescribeAddresses` lists them. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of addresses; allocate, associate with an instance, disassociate and release reach the emulator.

## Out of scope

- Moving addresses (`DescribeMovingAddresses` answers 501).
