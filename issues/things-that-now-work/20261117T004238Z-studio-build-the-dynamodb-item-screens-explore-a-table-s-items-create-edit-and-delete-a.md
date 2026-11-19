Issue-Id: 330
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|items
Issue-Check-Ids: studio.dynamodb-tables-made-outside-are-listed studio.dynamodb-routes-lead-to-the-table-screens studio.dynamodb-table-search-and-pages studio.dynamodb-table-details-show-what-the-emulator-holds studio.dynamodb-scan-shows-items-of-every-type studio.dynamodb-scan-pages-follow-the-emulator studio.dynamodb-query-by-key-and-condition studio.dynamodb-create-a-table-and-its-first-item studio.dynamodb-create-table-provisioned-and-refused studio.dynamodb-edit-an-item studio.dynamodb-delete-items studio.dynamodb-delete-a-table studio.dynamodb-table-gone-while-open studio.dynamodb-emulator-restart-shows-the-empty-emulator
Issue-Commit: (no commit yet)

# Build the DynamoDB item screens: explore a table's items, create, edit and delete an item

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's "Explore table items" (issue 72) leads to `/aws/dynamodb/tables/table/<name>/items`, which shows the area's "no screen yet" page; the console's navigation entry "Explore items" has no screen either. The emulator holds items.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb put-item --table-name t --item '{"pk":{"S":"a"}}'   -> 200 (three items put)
$ aws dynamodb scan --table-name t --select COUNT   -> 200, Count 3
$ aws dynamodb query / get-item / update-item / delete-item / batch-get-item / batch-write-item   -> 200
$ aws dynamodb describe-table --table-name t   -> ItemCount 0 and TableSizeBytes 0 after the puts
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose "Explore table items".
4. The page says there is no screen yet.

## Expected
- A table's items are scanned and queried with paging by the emulator's own key; an item can be created, edited and deleted, and the emulator's answer is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
PartiQL (its own issue). Bulk put items. Any engine change. Anything sent to real AWS.
