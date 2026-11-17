Issue-Id: 418
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|vpc-changes
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build a VPC's changes: "Edit VPC settings", "Manage tags", "Edit CIDRs", "Create default VPC" and the "Actions" of a VPC's page

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The "Actions" menu of the Your VPCs list (issue 282) leads, for "Edit VPC settings", "Manage tags", "Edit CIDRs" and "Create default VPC", to routes below `/aws/vpc/vpcs/` that show the area's "no screen yet" page (`/aws/vpc/vpcs/vpc/<id>/edit`, `…/manage-tags`, `…/edit-cidrs`, `/aws/vpc/vpcs/create-default`), and a VPC's page has no "Actions" menu. The user guide names "Edit VPC settings" with an "Enable" check box per DNS attribute and "Save changes", "Edit CIDRs" with "Add new IPv4 CIDR", "Add new IPv6 CIDR", "Remove" and "Save". The emulator answers the operations behind them but one.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 modify-vpc-attribute --enable-dns-hostnames / --enable-dns-support / --enable-network-address-usage-metrics   -> ok, read back by describe-vpc-attribute (one attribute per call)
$ aws ec2 associate-dhcp-options --vpc-id <vpc> --dhcp-options-id <set>   -> ok
$ aws ec2 modify-vpc-tenancy --instance-tenancy default (a dedicated VPC)   -> ok
$ aws ec2 create-tags; delete-tags; describe-tags --filters Name=resource-id,Values=<vpc>   -> ok; refused: a key that starts with aws:, an empty key, a key of 128 characters, a value of 257
$ aws ec2 associate-vpc-cidr-block --cidr-block 192.168.0.0/24; --amazon-provided-ipv6-cidr-block   -> ok; the same block again -> InvalidParameterValue
$ aws ec2 disassociate-vpc-cidr-block   -> 501 NotImplemented (a secondary and the primary block)
$ aws ec2 create-default-vpc while one exists   -> DefaultVpcAlreadyExists; after the default VPC was deleted -> ok, a new default VPC with three subnets and an internet gateway
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator (it holds a default VPC).
2. Open `/aws/vpc/vpcs`.
3. Select a VPC, open "Actions" and choose "Edit VPC settings".
4. The page says there is no screen yet.

## Expected
- Each of the four entries opens its console form and sends what the user changed; the list and the VPC's page then show what the emulator returns.
- "Remove" of a CIDR says "not implemented" while `DisassociateVpcCidrBlock` answers 501, never a success.
- A VPC's page has the "Actions" menu the console shows, once a capture or the guide gives its entries.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
A VPC's "Resource map" and "Flow logs" (their own issue). "Attach" and "Manage middlebox routes" (the gateways' and route tables' issues). Any engine change. Anything sent to real AWS.
