Issue-Id: 566
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.rule-change-and-tags|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Let a developer change a security group rule and tag a group or a key pair

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A rule of a security group (issue 553) can only be added and deleted, and groups and key pairs cannot be tagged in Studio.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `ModifySecurityGroupRules` and `UpdateSecurityGroupRuleDescriptionsIngress`/`…Egress` answer; `CreateTags` works on a group and a key pair. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- A rule's ports, source and description are changed from the group's page and the emulator reports the change; tags of a group and a key pair are shown and changed.

## Out of scope

- Nothing else.
