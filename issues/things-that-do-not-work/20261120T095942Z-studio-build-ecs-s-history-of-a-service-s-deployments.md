Issue-Id: 613
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.service-deployments|task
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's history of a service's deployments

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 11 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A service's page shows the deployments `DescribeServices` holds now; a developer cannot see the service's deployments over time in Studio.

The reference is the same request sent straight to aws-emulator: `ListServiceDeployments`, `DescribeServiceDeployments` (`DescribeServiceRevisions` was not probed: call it before designing on it). The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs list-service-deployments --service arn:aws:ecs:us-east-1:000000000000:service/p575-a/p575-svc
{"serviceDeployments":[{"serviceDeploymentArn":"arn:aws:ecs:us-east-1:000000000000:service-deployment/p575-a/p575-svc/EC9Rzo1nbzoO2YPvehasO","serviceArn":"arn:aws:ecs:us-east-1:000000000000:service/p575-a/p575-svc","clusterArn":"arn:aws:ecs:us-east-1:000000000000:cluster/p575-a","startedAt":"2026-11-20T14:19:13.67 …
[exit 0]
$ aws ecs describe-service-deployments --service-deployment-arns arn:aws:ecs:us-east-1:000000000000:service-deployment/p575-a/p575-svc/EC9Rzo1nbzoO2YPvehasL --query serviceDeployments[].status
["SUCCESSFUL"]
[exit 0]
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- A service's page lists the service's deployments the emulator's `ListServiceDeployments` answers, each with its status and times.
- A deployment can be opened and shows what `DescribeServiceDeployments` answers for it.

## Out of scope
- Stopping or rolling back a deployment.
