Issue-Id: 598
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.changes|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Build VPC's changes to what exists: DNS settings, tags, the main route table, a route's target

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On VPC's screens (issue 574) a developer can create and delete, and turn a subnet's public addresses on or off; nothing else of an existing resource can be changed: a VPC's DNS settings are read only, no tag of a VPC, subnet, route table or internet gateway can be added, changed or removed (the `Name` is set at creation only), another route table cannot be made the main one, and a route's target cannot be replaced.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2 and 3; scripts and logs kept with the issue's working files, `probe/`): `ModifyVpcAttribute` answers for `enableDnsSupport` and `enableDnsHostnames`; `CreateTags` and `DeleteTags` answer on a VPC, a subnet and an internet gateway; `ReplaceRouteTableAssociation` makes another table the main one; `ReplaceRoute` answers. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open a VPC's page under `/aws/vpc/vpcs`.
3. Look for a way to change its DNS settings or its tags: none.

## Expected

- A VPC's DNS settings can be changed; tags of a VPC, a subnet, a route table and an internet gateway can be added, changed and removed; a route table can be made its VPC's main one; a route's target can be replaced; each reaches the emulator and its refusal is shown as it came.

## Out of scope

- Further IPv4 blocks, tenancy and DHCP option sets.
