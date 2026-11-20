Issue-Id: 573
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|rds|tasks-by-the-emulator-api
Issue-Check-Ids: studio.rds-instances-made-elsewhere-are-shown studio.rds-create-a-db-instance-reaches-the-emulator studio.rds-stop-start-reboot-delete-a-db-instance studio.rds-cluster-from-create-to-delete studio.rds-clusters-made-elsewhere-are-shown studio.rds-screens-follow-an-emulator-restart
Issue-Commit: 68ba2ca428aaf0f893938e6af03157e5e2603054

# Build Aurora and RDS's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `68ba2ca428aaf0f893938e6af03157e5e2603054`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Aurora and RDS by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as S3, SQS, DynamoDB, Lambda, IAM,
SNS and EC2 were done (issues 480, 481, 496, 516, 535, 536, 553): find what the emulator supports of RDS, break what a
developer does with it locally into tasks, order them by importance and build from the top.

The probe of emulator 1.0.533 answers 29 of RDS's 34 reads without arguments; 5 are not implemented (proxy endpoints,
reserved instances and their offerings among them). The plan first finds what a DB instance and a cluster are in the
emulator (a record only, or a database a client can connect to at an endpoint), since that decides which tasks mean
anything locally: an instance's endpoint and how to connect to it are likely what a developer comes for. It then
settles what of instances, Aurora clusters, subnet groups, parameter groups and snapshots is a task here. A subnet
group names subnets and a DB instance names security groups: those are only read to choose one; the security groups
are EC2's (issue 553) and the subnets VPC's (issue 574). Issue 245 planned RDS the old way; this issue replaces it and
closes it. The area's shared parts on `main` are used where they fit.

## Evidence

`.pm/product/services.md` (row 8); `.pm/run/probe-services-20261120T051501Z.json` (emulator 1.0.533, service `rds`).

## Steps to Reproduce

Open `/aws/rds`: "No screen yet".

## Expected

A developer can do Aurora and RDS's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope

What the emulator does not support. The tasks below the cut the plan draws: it files each as an issue of its own.
