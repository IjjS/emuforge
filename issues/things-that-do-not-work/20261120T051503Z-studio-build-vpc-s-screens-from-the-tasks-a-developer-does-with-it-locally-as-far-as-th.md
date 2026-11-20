Issue-Id: 574
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|vpc|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 68ba2ca428aaf0f893938e6af03157e5e2603054

# Build VPC's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `68ba2ca428aaf0f893938e6af03157e5e2603054`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

VPC by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as S3, SQS, DynamoDB, Lambda, IAM, SNS
and EC2 were done (issues 480, 481, 496, 516, 535, 536, 553): find what the emulator supports of VPC, break what a
developer does with it locally into tasks, order them by importance and build from the top.

VPC has no API of its own: its operations are EC2's (the probe of emulator 1.0.533 answers 161 of the 180 reads the
board counts for `vpc`; 14 are not implemented). The border with EC2 is drawn already (issue 553, its requirement and
`.pm/archive/553.md`): instances, security groups with their rules and key pairs are EC2's and are built; VPCs,
subnets, route tables, gateways and endpoints are this issue's, and EC2's screens only read VPCs and subnets to choose
one. The plan keeps that border, never builds a screen EC2 has, and uses EC2's client and the area's shared listing
parts on `main` where they fit, saying in its breakdown which files of `services/ec2` it reads or changes, since
EC2's follow-ups (issues 559, 561) may run beside it. It finds what of a VPC means anything in the emulator (whether
routes, gateways and network ACLs change what anything can reach, or are records only), since that decides the tasks.
Issue 282 planned VPC the old way; this issue replaces it and closes it.

## Evidence

`.pm/product/services.md` (row 9); `.pm/run/probe-services-20261120T051501Z.json` (emulator 1.0.533, service `vpc`).

## Steps to Reproduce

Open `/aws/vpc`: "No screen yet".

## Expected

A developer can do VPC's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope

What the emulator does not support. The tasks below the cut the plan draws: it files each as an issue of its own.
