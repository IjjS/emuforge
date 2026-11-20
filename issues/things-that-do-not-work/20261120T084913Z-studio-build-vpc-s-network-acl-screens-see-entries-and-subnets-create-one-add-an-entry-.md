Issue-Id: 597
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.network-acls|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Build VPC's network ACL screens: see entries and subnets, create one, add an entry, give it a subnet, delete it

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see or change a network ACL in Studio.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2 and 3; scripts and logs kept with the issue's working files, `probe/`): `DescribeNetworkAcls`, `CreateNetworkAcl`, `CreateNetworkAclEntry`, `ReplaceNetworkAclEntry`, `ReplaceNetworkAclAssociation` and `DeleteNetworkAcl` answer; a VPC's default network ACL is not deleted. No call showed a network ACL deciding what code reaches (a function in a subnet whose ACL denies everything answered as one outside any VPC), so no screen may claim that it does or does not. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of network ACLs; one ACL's inbound and outbound entries and its subnets; create one in a VPC, add or replace an entry, give it a subnet, delete it; each reaches the emulator and its refusal is shown as it came.
- No text says what an entry lets through.

## Out of scope

- Saying what traffic an ACL allows.
