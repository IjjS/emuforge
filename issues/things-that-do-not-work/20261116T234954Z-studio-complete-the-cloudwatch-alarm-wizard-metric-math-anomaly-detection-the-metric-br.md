Issue-Id: 296
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|alarm-wizard-more
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Complete the CloudWatch alarm wizard: metric math, anomaly detection, the metric browser, the other actions

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The create and edit wizard of issue 70 holds an alarm on one metric with a static threshold and SNS notifications. The console's wizard also has: alarms on a metric math expression and on an anomaly detection band, the "Select metric" browser, and in step "Configure actions" the sections "Auto Scaling action" and "EC2 action" and the Lambda and Systems Manager actions. Studio shows an info alert instead of the wizard for an alarm with `Metrics` or `ThresholdMetricId`, and lists actions that are not SNS topics read-only. The two action sections are items of the wizard's reference spec that come out unmatched until this issue.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-metric-alarm --alarm-name probe70-math --evaluation-periods 1 --threshold 5 --comparison-operator LessThanThreshold --metrics '[{"Id":"e1","Expression":"m1*2","Label":"double","ReturnData":true},{"Id":"m1","MetricStat":{…},"ReturnData":false}]'
[exit 0]   (read back with Metrics)
$ aws cloudwatch put-metric-alarm --alarm-name p70-anomaly --evaluation-periods 1 --comparison-operator GreaterThanUpperThreshold --threshold-metric-id ad1 --metrics '[…]'
[exit 0]   (read back with ThresholdMetricId)
$ aws cloudwatch put-anomaly-detector --single-metric-anomaly-detector Namespace=Probe70/App,MetricName=Errors,Stat=Sum
[exit 0]
$ aws cloudwatch put-metric-alarm ... --alarm-actions not-an-arn
[exit 0]   (any action is stored and returned)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create an alarm on a metric math expression with the AWS CLI.
2. Open its page in Studio and choose "Actions", "Edit".
3. An info alert says Studio can edit alarms on one metric with a static threshold only.

## Expected
- An alarm on a metric math expression or an anomaly detection band can be created and edited in Studio.
- Step "Configure actions" has the sections "Auto Scaling action" and "EC2 action"; the two spec items match.
- The wizard's metric can be chosen from the metrics the emulator holds.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Composite alarms. The Metrics screens themselves. Any engine change. Anything sent to real AWS.
