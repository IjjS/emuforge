Issue-Id: 319
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|anomaly-detectors
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs anomaly detector screens ("Log Anomalies") and the log group list's column "Anomaly detection"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation has "Log Anomalies" and its log group list a column "Anomaly detection" whose cell is the link "Configure" for a group without a detector. Studio (issue 71) has neither: the column is recorded in the header comment of `log-group-list.yaml`. The emulator holds log anomaly detectors.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs create-log-anomaly-detector --log-group-arn-list arn:aws:logs:us-east-1:000000000000:log-group:p71-a-standard --detector-name p71-ad
{"anomalyDetectorArn":"arn:aws:logs:us-east-1:000000000000:anomaly-detector:00000000-0000-4000-8000-000000000001"}
$ aws logs list-log-anomaly-detectors   -> 200, anomalyDetectors [p71-ad] with logGroupArnList
$ aws logs list-log-anomaly-detectors --filter-log-group-arn arn:aws:logs:us-east-1:000000000000:log-group:p71-a-standard   -> 200, the same detector
(after the log group was deleted, list-log-anomaly-detectors still returned the detector)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group and an anomaly detector on it with the AWS CLI.
2. Open `/aws/logs/log-groups`.
3. The list has no column "Anomaly detection"; `/aws/logs/anomalies` says there is no screen yet.

## Expected
- The list has the column "Anomaly detection" after "Log class", as the console orders it, with "Configure" for a group without a detector, and the column is added to `log-group-list.yaml`.
- The emulator's anomaly detectors are listed; one can be created, changed and deleted; the side navigation gets "Log Anomalies".
- What the cell reads for a group with a detector needs a capture of such a row, or the requirement records where the words come from.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether the emulator ever finds an anomaly is for the requirement to probe. Any engine change. Anything sent to real AWS.
