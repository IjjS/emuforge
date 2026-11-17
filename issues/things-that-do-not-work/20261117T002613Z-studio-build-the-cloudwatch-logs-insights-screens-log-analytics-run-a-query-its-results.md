Issue-Id: 321
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|logs-insights
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs Insights screens ("Log Analytics"): run a query, its results, saved query definitions

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"View in Logs Insights" on the log group list (issue 71) leads to `/aws/logs/insights`, which shows the area's "no screen yet" page, and the console's navigation entry "Log Analytics" is not in Studio's. The emulator answers the query operations.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs start-query --log-group-name p71-a-standard --start-time 0 --end-time 1794874135 --query-string 'fields @message | limit 5'
{"queryId":"00000000-0000-4000-8000-000000000001"}
sweep with an empty body (probe-1-sweep.log):
200  DescribeQueries            {"queries":[]}
200  DescribeQueryDefinitions   {"queryDefinitions":[]}
400  GetQueryResults            InvalidParameterException … 'queryId' …
400  PutQueryDefinition         InvalidParameterException … 'name' …
400  StopQuery                  InvalidParameterException … 'queryId' …
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a log group with events.
2. Open `/aws/logs/log-groups` and choose "View in Logs Insights".
3. The page says there is no screen yet.

## Expected
- A query can be run on chosen log groups and its results read; running queries are listed and can be stopped; query definitions can be saved, listed and deleted.
- "View in Logs Insights" opens the screen with the selected log groups chosen; the side navigation gets "Log Analytics".
- The requirement finds what the emulator's query results hold before anything is designed.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Scheduled queries (the rest-of-the-API issue). Query generation from natural language. Any engine change. Anything sent to real AWS.
