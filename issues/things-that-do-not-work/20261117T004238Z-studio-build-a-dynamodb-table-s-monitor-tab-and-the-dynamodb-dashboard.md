Issue-Id: 337
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|monitor-and-dashboard
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build a DynamoDB table's "Monitor" tab and the DynamoDB "Dashboard"

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's tab "Monitor" (issue 72) leads to `/aws/dynamodb/tables/table/<name>/monitor`, which shows the area's "no screen yet" page, and the console's "Dashboard" has no screen. What the emulator's CloudWatch holds for a table was not probed while planning issue 72; this issue's requirement finds it out first.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb describe-table --table-name t   -> 200 (the table whose metrics the tab would show)
$ aws dynamodb describe-limits / describe-endpoints   -> 200
$ aws dynamodb list-contributor-insights / describe-contributor-insights --table-name t   -> 200
Not called: cloudwatch list-metrics --namespace AWS/DynamoDB after reads and writes on a table.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Monitor".
4. The page says there is no screen yet.

## Expected
- The requirement states what the emulator records for a table (CloudWatch metrics, Contributor Insights) by calling it; the tab and the dashboard show that, and a part the emulator does not have is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
CloudWatch's own screens (issue 70 and those filed from it). Any engine change. Anything sent to real AWS.
