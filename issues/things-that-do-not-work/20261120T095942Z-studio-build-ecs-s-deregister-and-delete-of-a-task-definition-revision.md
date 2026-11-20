Issue-Id: 610
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.deregister-task-definition|task
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's deregister and delete of a task definition revision

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 8 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A developer cannot deregister a revision in Studio, nor delete a deregistered one, and a family whose revisions are all inactive is not listed on "Task definitions" (it is reached only by its address).

The reference is the same request sent straight to aws-emulator: `DeregisterTaskDefinition`, `DeleteTaskDefinitions`, `ListTaskDefinitionFamilies` with `status` `INACTIVE`. The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs deregister-task-definition --task-definition p575-far:1 --query taskDefinition.status
"INACTIVE"
[exit 0]
$ aws ecs list-task-definitions --status INACTIVE
{"taskDefinitionArns":["arn:aws:ecs:us-east-1:000000000000:task-definition/p575-far:1"]}
[exit 0]
$ aws ecs delete-task-definitions --task-definitions p575-far:1 --query {td:taskDefinitions[].status,f:failures}
{"td":["DELETE_IN_PROGRESS"],"f":[]}
[exit 0]
$ aws ecs delete-task-definitions --task-definitions p575-log:1 --query {td:taskDefinitions[].status,f:failures}
{"td":[],"f":[{"arn":"arn:aws:ecs:us-east-1:000000000000:task-definition/p575-log:1","reason":"The specified task definition is still in ACTIVE status. Please deregister the target and try again."}]}
[exit 0]
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- On a revision's page, and for chosen revisions of a family's page, "Deregister" makes the emulator describe the revision as `INACTIVE`; the page shows it so.
- A deregistered revision can be deleted; the emulator then no longer lists it, and a failure the emulator answers in `failures` (a revision still `ACTIVE`) is shown with its reason.
- "Task definitions" can list the families that have only inactive revisions.

## Out of scope
- Changing a registered revision, which ECS does not have.
