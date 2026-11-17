Issue-Id: 339
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|auto-scaling
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Add auto scaling of a DynamoDB table's capacity to "Create table" and "Additional settings"

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's "Create table" and a table's "Read/write capacity" hold auto scaling controls under "Read capacity" and "Write capacity" ("Auto scaling", "Minimum capacity units", "Maximum capacity units", "Target utilization"). Studio's "Create table" (issue 72) has only the provisioned units. They belong to Application Auto Scaling, which the emulator answers for the namespace `dynamodb`. A reference spec cannot hold the controls today: each label occurs twice in one section, and a section's fields are one list of distinct labels.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws application-autoscaling describe-scalable-targets --service-namespace dynamodb   -> 200
$ aws application-autoscaling describe-scaling-policies --service-namespace dynamodb   -> 200
Not called: register-scalable-target, put-scaling-policy.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/dynamodb/tables/create`, choose "Customize settings" and "Provisioned".
3. "Read capacity" and "Write capacity" are a number each; there is no "Auto scaling".

## Expected
- The requirement finds out by calling whether the emulator keeps a scalable target and a scaling policy for a table; if it does, the controls exist on both screens, send them and read them back.
- How a spec holds two fields with the same label in one section is decided with the `pm` first.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether the emulator ever changes a table's capacity by itself. Any engine change. Anything sent to real AWS.
