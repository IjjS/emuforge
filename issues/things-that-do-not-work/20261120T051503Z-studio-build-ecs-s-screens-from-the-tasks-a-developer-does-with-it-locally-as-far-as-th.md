Issue-Id: 575
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|ecs|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 68ba2ca428aaf0f893938e6af03157e5e2603054

# Build ECS's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `68ba2ca428aaf0f893938e6af03157e5e2603054`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

ECS by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as S3, SQS, DynamoDB, Lambda, IAM, SNS
and EC2 were done (issues 480, 481, 496, 516, 535, 536, 553): find what the emulator supports of ECS, break what a
developer does with it locally into tasks, order them by importance and build from the top.

The probe of emulator 1.0.533 answers 7 of ECS's 12 reads without arguments; the other 5 need a cluster and answered
`ClusterNotFoundException`, so they are not known to be missing. The plan first finds what a task and a service are in
the emulator (records only, or containers that run and whose logs can be read), since that decides which tasks mean
anything locally. It then settles what of clusters, task definitions, services and tasks is built here. A service or
task names subnets and security groups, and a task definition names roles: those are only read to choose one and
belong to VPC (issue 574), EC2 (issue 553) and IAM (issue 535). Issue 164 holds ECS's console captures as the old
method listed it; this issue replaces it and closes it. The area's shared parts on `main` are used where they fit.

## Evidence

`.pm/product/services.md` (row 10); `.pm/run/probe-services-20261120T051501Z.json` (emulator 1.0.533, service `ecs`).

## Steps to Reproduce

Open `/aws/ecs`: "No screen yet".

## Expected

A developer can do ECS's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope

What the emulator does not support. The tasks below the cut the plan draws: it files each as an issue of its own.
