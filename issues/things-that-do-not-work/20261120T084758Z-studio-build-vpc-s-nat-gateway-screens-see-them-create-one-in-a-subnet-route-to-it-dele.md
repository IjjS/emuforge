Issue-Id: 595
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.nat-gateways|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Build VPC's NAT gateway screens: see them, create one in a subnet, route to it, delete it

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create or delete a NAT gateway in Studio, nor add a route to one: VPC's screens (issue 574) show a route to a NAT gateway made elsewhere with its target as text, and "Add route" offers an internet gateway only.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2 and 3; scripts and logs kept with the issue's working files, `probe/`): `CreateNatGateway` answers for a private one and for a public one with an Elastic IP, the gateway reads `pending` then `available`; `DeleteNatGateway` takes it to `deleted`, and it stays listed; a route to a deleted one stays `active`; a subnet that holds one is not deleted (`DependencyViolation`); `DescribeNatGateways` lists them. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of NAT gateways with their state, subnet and VPC; create one in a subnet (private, or public with an Elastic IP the emulator holds); delete one; each reaches the emulator and its refusal is shown as it came.
- A route table's "Add route" can lead to a NAT gateway of the table's VPC.

## Out of scope

- Allocating an Elastic IP (EC2's task, issue 560).
