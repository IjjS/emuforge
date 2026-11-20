Issue-Id: 609
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.create-service|task
Issue-Check-Ids: studio.ecs-create-service-opens-the-created-service,studio.ecs-create-service-keeps-input-on-duplicate-name
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's create service screen

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 7 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A developer cannot create a service in Studio: a service is seen, updated and deleted there, but made only with the AWS CLI or an IaC tool.

The reference is the same request sent straight to aws-emulator: `CreateService`. The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs create-service --cluster p575-a --service-name p575-svc --task-definition p575-far --desired-count 2 --launch-type FARGATE --network-configuration awsvpcConfiguration={subnets=[subnet-00000000000000007],securityGroups=[sg-0000000000000000d],assignPublicIp=ENABLED}
{"service":{"serviceArn":"arn:aws:ecs:us-east-1:000000000000:service/p575-a/p575-svc","serviceName":"p575-svc", … "status":"ACTIVE","desiredCount":2,"runningCount":0,"pendingCount":2,"launchType":"FARGATE", …
[exit 0]
$ aws ecs create-service … (the same name again) --query service.serviceArn
aws: [ERROR]: An error occurred (InvalidParameterException) when calling the CreateService operation: Creation of service was not idempotent.
[exit 254]
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- From a cluster's page a developer creates a service: a name, a task definition revision, a desired count, subnets, security groups and whether a public IP is assigned; the emulator then describes the service as `ACTIVE` with that count.
- The service's page opens and says the service was created.
- The emulator's refusal (a name that exists: `InvalidParameterException` "Creation of service was not idempotent.") is shown on the form, which keeps what was entered.

## Out of scope
- Load balancers, service discovery, auto scaling and deployment settings beyond what the emulator plays.
- The EC2 launch type, which the emulator does not have.
