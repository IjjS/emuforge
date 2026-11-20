Issue-Id: 612
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.cluster-settings|task
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's cluster settings and capacity providers

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 10 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A developer cannot see or change a cluster's settings (Container Insights) or its capacity providers in Studio.

The reference is the same request sent straight to aws-emulator: `UpdateClusterSettings`, `PutClusterCapacityProviders`, `DescribeCapacityProviders`. The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs update-cluster-settings --cluster p575-a --settings name=containerInsights,value=enabled --query cluster.settings
[{"name":"containerInsights","value":"enabled"}]
[exit 0]
$ aws ecs put-cluster-capacity-providers --cluster p575-a --capacity-providers FARGATE --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 --query cluster.capacityProviders
["FARGATE"]
[exit 0]
$ aws ecs describe-capacity-providers
{
    "capacityProviders": [ …
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- A cluster's page shows its settings and its capacity providers with the default strategy, as the emulator describes them.
- A setting or the capacity providers changed there are what the emulator's `DescribeClusters` then answers.

## Out of scope
- Capacity providers of an Auto Scaling group, which need the EC2 launch type the emulator does not have.
