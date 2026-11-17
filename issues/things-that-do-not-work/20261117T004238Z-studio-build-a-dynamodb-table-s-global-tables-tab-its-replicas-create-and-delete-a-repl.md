Issue-Id: 334
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|global-tables
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build a DynamoDB table's "Global tables" tab: its replicas, create and delete a replica

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's tab "Global tables" (issue 72) leads to `/aws/dynamodb/tables/table/<name>/global-tables`, which shows the area's "no screen yet" page; the table list and a table's page show the Regions of the replicas only. The emulator stores replicas.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb update-table --table-name t --replica-updates '[{"Create":{"RegionName":"us-west-2"}}]'   -> 200, TableStatus UPDATING, DescribeTable returns Replicas
$ aws dynamodb list-global-tables   -> 200
$ aws dynamodb create-global-table (the 2017 version)   -> 400, "no longer supported"
$ aws dynamodb delete-table of a table with a replica   -> 200, deleted like any other
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Global tables".
4. The page says there is no screen yet.

## Expected
- The tab lists the table's replicas with their Region and status; a replica can be created and deleted; the emulator's answer is shown. The requirement finds out whether the emulator holds the replica as a table of the other Region.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The 2017 version of global tables, which the emulator refuses. Any engine change. Anything sent to real AWS.
