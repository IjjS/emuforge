Issue-Id: 627
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|ecs.run-task-without-public-ip|pending
Issue-Check-Ids: studio.ecs-task-run-without-a-public-ip-fails-to-start
Issue-Commit: 24cf8f1c80a7b730bb24db779b02f02eed4c8511

# Resolve the ECS no-public-IP task check that remains pending

> Identified against commit `24cf8f1c80a7b730bb24db779b02f02eed4c8511`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The existing ECS Run task scenario with public IP disabled did not observe its expected terminal state. This blocks the whole check of issue 609. The changed service creation flow passed both of its integration checks. The run-task form, task-detail reader and failing scenario were unchanged from the merge base.

## Evidence

The whole check on 24cf8f1c8 used aws-emulator 1.0.550. After 60 seconds the task page still reported PENDING where the check expects Stopped. The Playwright snapshot also shows desired status Running and no stop code. The test stopped before its direct DescribeTasks assertion, so this run alone does not establish whether the emulator was still pending or Studio showed stale data.

- Whole record: emuforge-609/output/checks/last.json
- Run log: emuforge-609/output/logs/check-integration.log
- Per-check verdict: emuforge-609/output/integration/verdicts/studio.ecs-task-run-without-a-public-ip-fails-to-start.json
- Snapshot: emuforge-609/output/integration/playwright/ecs-tasks-studio-ecs-task--317d0--a-public-ip-fails-to-start/error-context.md

## Steps to Reproduce

1. Create a cluster and register the Fargate definition with awslogs used by the existing task check.
2. In Run task, choose that revision and a default VPC subnet, turn off Assign a public IP and submit.
3. Observe the task's status and stop code. Compare the settled task page with direct DescribeTasks on the same emulator.

## Expected

Establish the current emulator behavior and ensure Studio follows the task to its actual state. The confirmed check expects Stopped with TaskFailedToStart. If emulator behavior changed, take the evidence to the PM before changing the criterion.

## Out of scope

Creating or editing ECS services.
