Issue-Id: 331
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|indexes
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build DynamoDB secondary indexes: a table's indexes, create and delete a global secondary index, and "Secondary indexes" of "Create table"

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's page (issue 72) shows only the number of indexes, and the section "Secondary indexes" of "Create table" is an item of the reference spec `studio/references/console/dynamodb/create-table.yaml` that issue 72 leaves unbuilt (its one unmatched item). The emulator stores global and local secondary indexes given at creation and creates and deletes a global secondary index on a table.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb create-table ... --global-secondary-indexes ... --local-secondary-indexes ...   -> 200, DescribeTable returns both lists
$ aws dynamodb update-table --table-name t --attribute-definitions ... --global-secondary-index-updates '[{"Create":{...}}]'   -> 200, TableStatus UPDATING, the index is returned
$ aws dynamodb update-table --table-name t --global-secondary-index-updates '[{"Delete":{...}}]'   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/dynamodb/tables/create` and choose "Customize settings".
3. There is no section "Secondary indexes".

## Expected
- "Create table" has the section "Secondary indexes" and sends the indexes; the spec's item matches (31/31).
- A table's indexes are listed with their keys, projection and status; a global secondary index can be created and deleted.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Auto scaling of an index. Items of an index. Any engine change. Anything sent to real AWS.
