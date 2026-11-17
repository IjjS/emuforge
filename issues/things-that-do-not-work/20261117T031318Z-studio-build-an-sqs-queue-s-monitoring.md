Issue-Id: 377
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|monitoring
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build an SQS queue's "Monitoring"

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The AWS user guide names a tab "Monitoring" of a queue's page; Studio's queue page (issue 79) has no tabs. The emulator's CloudWatch lists metrics for a queue.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws cloudwatch list-metrics --namespace AWS/SQS   -> 200, eight metrics per queue (dimension QueueName)
Not called: get-metric-data for them.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a queue with the AWS CLI.
2. Open `/aws/sqs/queues` and select the queue.
3. Open the queue's page.
4. Nothing shows the queue's metrics.

## Expected
- The requirement finds out by calling which data points the emulator returns for a queue's metrics; the tab shows those, and a metric the emulator has no data for is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
CloudWatch's own screens. Any engine change. Anything sent to real AWS.
