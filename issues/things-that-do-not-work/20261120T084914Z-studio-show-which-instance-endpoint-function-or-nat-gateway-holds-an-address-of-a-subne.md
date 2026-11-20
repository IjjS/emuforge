Issue-Id: 600
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.network-interfaces|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Show which instance, endpoint, function or NAT gateway holds an address of a subnet

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A subnet's page (issue 574) shows its free addresses but not what holds the others, and a refused delete says only that the subnet has dependencies. A developer cannot find in Studio what is in a subnet.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2 and 3; scripts and logs kept with the issue's working files, `probe/`): `DescribeNetworkInterfaces` answers with the interfaces of instances, endpoints, a function in a VPC and a NAT gateway, each with its subnet and private address; `DeleteSubnet` is refused `DependencyViolation` while an instance that is not terminated, a NAT gateway or a function's network interface is in it. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio, and launch an instance into a subnet.
2. Open that subnet's page under `/aws/vpc/subnets`.
3. Nothing names the instance; "Delete subnet" is refused without naming it.

## Expected

- A subnet's page lists the network interfaces in it: the address, what holds it (an instance, an endpoint, a function, a NAT gateway) and its state, read from the emulator.

## Out of scope

- Creating, attaching or deleting a network interface (EC2's side).
