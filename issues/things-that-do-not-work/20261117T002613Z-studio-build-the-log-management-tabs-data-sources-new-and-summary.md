Issue-Id: 325
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|data-sources-and-summary-tabs
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the Log management tabs "Data sources - new" and "Summary"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The log group list (issue 71) has the console's tabs "Log groups", "Data sources - new" and "Summary"; the last two lead to `/aws/logs/data-sources` and `/aws/logs/summary`, which show the area's "no screen yet" page. The emulator knows the operations behind them. No capture shows the content of either tab, so this issue needs captures of both under `docs/aws-console/cloudwatch/` before its specs can be written.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs list-log-groups   -> 200, logGroups with logGroupName, logGroupArn, logGroupClass
sweep with an empty body (probe-1-sweep.log):
200  ListLogGroups                    {"logGroups":[]}
400  ListAggregateLogGroupSummaries   InvalidParameterException … 'groupBy' … (known, not 501)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a log group.
2. Open `/aws/logs/log-groups` and choose the tab "Summary".
3. The page says there is no screen yet.

## Expected
- Each tab shows what the emulator returns for it, or says "not implemented" for an operation answered 501.
- The requirement calls `ListAggregateLogGroupSummaries` and `ListLogGroups` with real arguments first.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The tab "Log groups" (issue 71). Any engine change. Anything sent to real AWS.
