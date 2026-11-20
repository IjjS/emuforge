Issue-Id: 611
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.tags|task
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's tags of a cluster, a service, a task and a task definition

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 9 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A developer cannot see or change the tags of an ECS resource in Studio.

The reference is the same request sent straight to aws-emulator: `ListTagsForResource`, `TagResource`, `UntagResource`. The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs tag-resource --resource-arn arn:aws:ecs:us-east-1:000000000000:cluster/p575-a --tags key=a,value=b
[exit 0]
$ aws ecs list-tags-for-resource --resource-arn arn:aws:ecs:us-east-1:000000000000:cluster/p575-a
{"tags":[{"key":"team","value":"x"},{"key":"a","value":"b"}]}
[exit 0]
$ aws ecs untag-resource --resource-arn arn:aws:ecs:us-east-1:000000000000:cluster/p575-a --tag-keys a
[exit 0]
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- The pages of a cluster, a service, a task and a revision show the resource's tags as the emulator lists them.
- A tag added or removed there is listed, or no longer listed, by the emulator's `ListTagsForResource`.
- The emulator's refusal of a tag is shown where the tag was entered.

## Out of scope
- Tag propagation from a service or a task definition to its tasks.
