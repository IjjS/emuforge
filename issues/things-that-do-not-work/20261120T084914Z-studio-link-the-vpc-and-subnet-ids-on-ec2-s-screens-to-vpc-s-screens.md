Issue-Id: 602
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.vpc-links|not-built
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Link the VPC and subnet IDs on EC2's screens to VPC's screens

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

EC2's screens show a VPC's and a subnet's ID as text. Since issue 574 each has a page of its own (`/aws/vpc/vpcs/vpc/{id}`, `/aws/vpc/subnets/subnet/{id}`), so the ID could lead there. Issue 574 left it out as EC2's side of the border (its requirement, "The border with EC2" and "Out of scope"): it changes files of `services/ec2`, which issues 559 and 561 may hold.

## Evidence

The diff of `feat/574` against `main` changes EC2's files only to import the parts lifted into the area (`git diff main...feat/574 --stat -- studio/src/providers/aws/area/services/ec2`); no EC2 page gained a link. On the built app of `feat/574`, an instance's page and a security group's page show the IDs as plain values.

## Steps to Reproduce

1. Start a fresh emulator and Studio and launch an instance.
2. Open its page under `/aws/ec2/instances`.
3. Its "VPC ID" and "Subnet ID" are text, not links.

## Expected

- A VPC ID and a subnet ID shown on EC2's instance and security group screens are links to that resource's page in VPC's screens.

## Out of scope

- Links from VPC's screens to EC2's.
