Issue-Id: 329
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|table-additional-settings
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build a DynamoDB table's "Additional settings": capacity, deletion protection, table class, TTL, encryption, tags

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's page (issue 72) has the tab "Additional settings", which leads to `/aws/dynamodb/tables/table/<name>/additional-settings` and shows the area's "no screen yet" page. The emulator stores every setting the tab holds: read/write capacity (the mode and provisioned units), an on-demand table's maximum throughput (`OnDemandThroughput`) and a table's warm throughput (`WarmThroughput`), deletion protection, the table class, Time to Live, encryption and tags. Maximum throughput and warm throughput are also missing from "Create table" and from a table's "Additional details".

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb update-table --table-name t --billing-mode PROVISIONED --provisioned-throughput ReadCapacityUnits=4,WriteCapacityUnits=6   -> 200, TableStatus UPDATING, ACTIVE about 3 s later, read back 4 and 6
$ aws dynamodb update-table --table-name t --table-class STANDARD_INFREQUENT_ACCESS   -> 200, read back in TableClassSummary
$ aws dynamodb update-table --table-name t --deletion-protection-enabled   -> 200, read back true
$ aws dynamodb create-table ... --on-demand-throughput MaxReadRequestUnits=..,MaxWriteRequestUnits=..   -> 200, DescribeTable returns OnDemandThroughput
$ aws dynamodb create-table ... --warm-throughput ...   -> 200, DescribeTable returns WarmThroughput
$ aws dynamodb update-time-to-live / describe-time-to-live   -> 200
$ aws dynamodb tag-resource / untag-resource / list-tags-of-resource   -> 200; tags given at creation are listed once the table is ACTIVE
$ aws dynamodb update-table --table-name t --provisioned-throughput <the current values>   -> 400 ValidationException
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Additional settings".
4. The page says there is no screen yet.

## Expected
- The tab shows the table's capacity, maximum and warm throughput, deletion protection, class, TTL, encryption and tags, and each can be edited; the emulator's answer, a refusal included, is shown.
- "Create table" and a table's "Additional details" hold maximum throughput and warm throughput.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Auto scaling (its own issue). Indexes. Streams. Any engine change. Anything sent to real AWS.
