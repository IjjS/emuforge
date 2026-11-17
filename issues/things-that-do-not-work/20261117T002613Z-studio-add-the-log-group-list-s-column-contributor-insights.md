Issue-Id: 323
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|contributor-insights-column
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Add the log group list's column "Contributor Insights"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's log group list has a column "Contributor Insights". Studio's list (issue 71) does not have it, recorded in the header comment of `log-group-list.yaml`. What it shows comes from CloudWatch's Contributor Insights rules, which the emulator holds (`cloudwatch DescribeInsightRules`; a rule's definition names its log groups) and whose own screens are another issue (the Contributor Insights rules issue filed from issue 70). Every row of the owner's capture `28-log-management` shows "-" in this column, so what a cell reads for a group with a rule cannot be pointed to yet.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws cloudwatch describe-insight-rules   -> 200, {"InsightRules":[]}
(planning issue 70, same emulator version:)
$ aws cloudwatch put-insight-rule --rule-name probe70-rule --rule-state ENABLED --rule-definition '{"Schema":{"Name":"CloudWatchLogRule","Version":1},"LogGroupNames":["probe70"],…}'
[exit 0]
$ aws cloudwatch describe-insight-rules   -> 200 with the rule
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group and a Contributor Insights rule that names it with the AWS CLI.
2. Open `/aws/logs/log-groups`.
3. The list has no column "Contributor Insights".

## Expected
- The list has the column "Contributor Insights" between "Metric filters" and "Subscription filters", as the console orders it, and the column is added to `log-group-list.yaml`.
- Its cell for a group with a rule uses the console's words from a capture of such a row, or the requirement records where the words come from.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The Contributor Insights rule screens themselves. Any engine change. Anything sent to real AWS.
