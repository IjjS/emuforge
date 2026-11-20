Issue-Id: 553
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|ec2|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 52ec3eed0717188191120a2cc0d9349e00f4d5a6

# Build EC2's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `52ec3eed0717188191120a2cc0d9349e00f4d5a6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

EC2 by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as S3, SQS, DynamoDB, Lambda, IAM and
SNS were done (issues 480, 481, 496, 516, 535, 536): find what the emulator supports of EC2, break what a developer does
with it locally into tasks, order them by importance and build from the top.

EC2's API is large (the probe of emulator 1.0.515: 182 of 206 reads without arguments answer, 18 are not implemented) and
holds VPC's too (board row 9, issue 282: VPCs, subnets, route tables, gateways, endpoints; 159 of 180 reads). The plan
first draws the border: what is EC2's here (likely instances and their lifecycle, key pairs, security groups as an
instance needs them, volumes and snapshots, images, Elastic IPs) and what is left to VPC's issue, and writes it into
the requirement so that the two never build one screen twice. It then finds what an instance is in the emulator (a
record only, or something that runs), since that decides which tasks mean anything locally. Issue 73 planned EC2 the
old way (an instances list); this issue replaces it and closes it. The area's shared parts on `main` are used where
they fit.

## Evidence

`.pm/product/services.md` (rows 7 and 9); the newest `.pm/run/probe-services-*.json` (services `ec2`, `vpc`).

## Steps to Reproduce

Open `/aws/ec2`: "No screen yet".

## Expected

A developer can do EC2's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope
