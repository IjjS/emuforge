Issue-Id: 434
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|create-vpc-and-more
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Add to "Create VPC": "VPC and more", "IPv6 CIDR owned by me" and "Network Border Group"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Create VPC" (issue 282) creates a VPC alone: of "Resources to create" the choice "VPC and more" is shown and disabled, and "IPv6 CIDR block" offers "No IPv6 CIDR block" and "Amazon-provided IPv6 CIDR block" only. The user guide's "VPC and more" has "Name tag auto-generation", "Number of Availability Zones (AZs)", "Number of public subnets", "Number of private subnets", "NAT gateways", "VPC endpoints", "DNS options", "Additional tags" and a "Preview"; it names "IPv6 CIDR owned by me" and "Network Border Group" too. The emulator answers each call such a form makes.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 create-vpc --cidr-block ...; create-subnet; create-internet-gateway; attach-internet-gateway; create-route-table; create-route; associate-route-table; allocate-address; create-nat-gateway; create-vpc-endpoint (Gateway, s3); modify-vpc-attribute   -> ok each
$ aws ec2 create-vpc --ipv6-pool <pool> --ipv6-cidr-block <block>   -> ok, an association (of a pool the emulator does not hold)
$ aws ec2 create-vpc --amazon-provided-ipv6-cidr-block --ipv6-cidr-block-network-border-group us-east-1   -> ok
$ aws ec2 create-vpc --ipv4-ipam-pool-id <pool>; --ipv6-ipam-pool-id <pool>   -> 501 NotImplemented "operation CreateVpc with an IPAM-allocated CIDR block is scaffolded but not implemented in this emulator"
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/vpcs/create`.
3. "VPC and more" cannot be chosen; "IPv6 CIDR block" has two choices.

## Expected
- "VPC and more" creates the VPC with its subnets, route tables, gateways and endpoints as the form says, one call after the other; when a call is refused the form says which resources exist, read back from the emulator, and nothing is reported as created that is not.
- "IPv6 CIDR owned by me" offers what the requirement finds the emulator holds for it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The IPAM-allocated choices (IPAM's own issue; the emulator answers 501). Any engine change. Anything sent to real AWS.
