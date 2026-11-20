Issue-Id: 601
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.default-vpc|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Make the default VPC or a default subnet again from VPC's screens

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

After the default VPC or one of its default subnets is deleted, Studio offers no way to make it again; a plain "Create VPC" makes one that is not the default.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 4; scripts and logs kept with the issue's working files, `probe/`): the default VPC can be taken apart and deleted, after which `DescribeVpcs` is empty; `CreateDefaultVpc` makes it again with three default subnets; `CreateDefaultSubnet` answers. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Delete the default VPC's subnets, detach and delete its internet gateway, delete the VPC, in VPC's screens.
3. Look for a way to make the default VPC again: none.

## Expected

- While the emulator holds no default VPC, the VPCs list offers to create it; a default VPC without a default subnet in a zone offers to create that subnet; each reaches the emulator and its refusal is shown as it came.

## Out of scope

- Nothing else.
