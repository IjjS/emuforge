Issue-Id: 298
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|metrics
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch metrics screens: the namespaces and metrics the emulator holds and their data

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/cloudwatch/metrics` shows the area's "no screen yet" page. The emulator holds metrics and their data: a metric appears after `PutMetricData`, and a fresh emulator already lists `AWS/Usage` `CallCount` metrics of its own calls.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-metric-data --namespace Probe70/App --metric-data MetricName=Errors,Value=7
[exit 0]
$ aws cloudwatch list-metrics --namespace Probe70/App   -> 200, Metrics [Errors]
$ aws cloudwatch get-metric-statistics / get-metric-data for it   -> 200 with the datapoint
$ aws cloudwatch list-metrics   (fresh emulator) -> 200, AWS/Usage CallCount metrics
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and put metric data with the AWS CLI.
2. Open `/aws/cloudwatch/metrics`.
3. The page says there is no screen yet.

## Expected
- The namespaces and metrics the emulator holds are listed, and a metric's data is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The alarm wizard's metric browser (its own issue). Any engine change. Anything sent to real AWS.
