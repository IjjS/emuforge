Issue-Id: 317
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|metric-filters
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs metric filter screens: list, create, edit, delete

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The log group list and a log group's page (issue 71) show the number of a group's metric filters, but nothing lists, creates, changes or deletes one. The emulator holds metric filters.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs put-metric-filter --log-group-name p71-a-standard --filter-name p71-mf --filter-pattern ERROR --metric-transformations metricName=Errors,metricNamespace=P71/App,metricValue=1
[exit 0]
$ aws logs describe-metric-filters --log-group-name p71-a-standard   -> 200, metricFilters [p71-mf] with filterPattern, metricTransformations, creationTime
$ aws logs describe-log-groups --log-group-identifiers p71-a-standard   -> metricFilterCount 1
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group and a metric filter with the AWS CLI.
2. Open the log group's page in Studio.
3. "Metric filters" reads 1 and nothing shows the filter.

## Expected
- A log group's metric filters are listed on its page; a filter can be created, edited and deleted; the emulator's answer, a refusal included, is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Subscription filters (their own issue). The metrics the filters emit (issue 70's metrics issue). Any engine change. Anything sent to real AWS.
