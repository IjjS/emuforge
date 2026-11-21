Issue-Id: 626
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|ecs.task-without-public-ip|pending-instead-of-failed-to-start
Issue-Check-Ids: studio.ecs-task-run-without-a-public-ip-fails-to-start
Issue-Commit: c9be571c0103c5e4cf0640637a3f928f1afb4d34

# Resolve the pending ECS task in the no-public-IP failed-start check

> Identified against commit `c9be571c0103c5e4cf0640637a3f928f1afb4d34`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The ECS failed-start scenario launches a task with public IP assignment disabled. Its detail page still reports PENDING at the 60-second deadline for the expected stopped outcome. The scenario fails before reaching its direct DescribeTasks assertion, so the evidence does not establish whether the emulator or the displayed state caused the timeout.

## Evidence

The same check failed on local main at e9aa676f278e557b4ac19d5d24711f2c3ceb0e32 and in the whole check of issue 559 at c9be571c0103c5e4cf0640637a3f928f1afb4d34. In each checkout see output/integration/logs/studio.ecs-task-run-without-a-public-ip-fails-to-start.log and output/logs/check-integration.log. Both logs record expected “Stopped”, received “PENDING”, timeout 60000 ms. Issue 559 used emulator 1.0.550. Its three normal EC2 volume scenarios passed.

## Steps to Reproduce

1. Run the named integration scenario against the local emulator through pm-check.
2. The scenario creates a cluster and task definition and submits Run task with “Assign a public IP” unchecked.
3. Observe the task detail's Last status and compare it with the emulator's DescribeTasks answer.

## Expected

The scenario observes the stopped task and TaskFailedToStart reason in Studio and confirms both directly against the emulator.

## Out of scope

EC2 volume management and unrelated ECS task outcomes.
