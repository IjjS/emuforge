Issue-Id: 599
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.peering|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Build VPC's peering connection screens: create one, accept it, route to it

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create or accept a VPC peering connection in Studio; a route to one made elsewhere is shown with its target as text.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2; scripts and logs kept with the issue's working files, `probe/`): `CreateVpcPeeringConnection`, `AcceptVpcPeeringConnection` and `DescribeVpcPeeringConnections` answer, and a route to a peering connection is accepted. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of peering connections with their two VPCs and state; create one between two VPCs of the emulator, accept it, delete it; a route table's "Add route" can lead to one; each reaches the emulator and its refusal is shown as it came.

## Out of scope

- Peering across accounts or Regions unless a call shows the emulator holds it.
