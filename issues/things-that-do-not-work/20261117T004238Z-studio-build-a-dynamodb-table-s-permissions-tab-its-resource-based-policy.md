Issue-Id: 336
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|table-permissions
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build a DynamoDB table's "Permissions" tab: its resource-based policy

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's tab "Permissions" (issue 72) leads to `/aws/dynamodb/tables/table/<name>/permissions`, which shows the area's "no screen yet" page. "Create table" (issue 72) can give a table a resource-based policy, and the emulator keeps it, but Studio cannot show, change or delete it afterwards.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb create-table ... --resource-policy '<a policy>'   -> 200
$ aws dynamodb get-resource-policy --resource-arn <table>   -> 200, the policy and a RevisionId
$ aws dynamodb put-resource-policy --resource-arn <table> --policy '<a policy>'   -> 200
$ aws dynamodb put-resource-policy --policy 'not json'   -> 400 ValidationException
$ aws dynamodb delete-resource-policy --resource-arn <table>   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Permissions".
4. The page says there is no screen yet.

## Expected
- The tab shows the table's resource-based policy as text; it can be created, edited and deleted, and the emulator's answer, a refusal included, is shown.
- The screen says that the emulator stores the policy; whether anything evaluates it is for the requirement to find out.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
IAM evaluation by the engine. The console's policy examples and Access Analyzer preview. Any engine change. Anything sent to real AWS.
