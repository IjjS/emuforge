Issue-Id: 596
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.endpoints|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Build VPC's endpoint screens: see them, create a gateway or an interface endpoint, delete one

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A developer cannot see, create or delete a VPC endpoint in Studio. A route a gateway endpoint added to a route table is shown on the table's page with its target as text.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 2; scripts and logs kept with the issue's working files, `probe/`): `DescribeVpcEndpoints`, `DescribeVpcEndpointServices`, `CreateVpcEndpoint` (gateway and interface) and `DeleteVpcEndpoints` answer; a gateway endpoint adds a route to its route tables and takes it away again when deleted. The requirement of issue 574 lists this task in its task table as answered by the emulator and left out of that issue (tasks 4 to 10 go to later issues, each filed at its close).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc`.
3. Look for the task: no screen or action offers it.

## Expected

- A list of endpoints with their type, service, VPC and state; create a gateway endpoint with its route tables or an interface endpoint with its subnets; delete one; each reaches the emulator and its refusal is shown as it came.

## Out of scope

- Endpoint services of one's own and their connections.
