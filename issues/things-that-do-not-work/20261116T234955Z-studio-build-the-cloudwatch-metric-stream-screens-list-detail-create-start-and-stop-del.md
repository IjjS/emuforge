Issue-Id: 299
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|metric-streams
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch metric stream screens: list, detail, create, start and stop, delete

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/cloudwatch/metric-streams` shows the area's "no screen yet" page. The emulator holds metric streams.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-metric-stream --name probe70-stream --firehose-arn arn:aws:firehose:us-east-1:000000000000:deliverystream/probe70 --role-arn arn:aws:iam::000000000000:role/probe70 --output-format json
[exit 0]
$ aws cloudwatch list-metric-streams   -> 200 with the stream
$ aws cloudwatch get-metric-stream --name probe70-stream   -> 200
$ aws cloudwatch stop-metric-streams --names probe70-stream   -> 200
$ aws cloudwatch start-metric-streams --names probe70-stream  -> 200
$ aws cloudwatch delete-metric-stream --name probe70-stream   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and put a metric stream with the AWS CLI.
2. Open `/aws/cloudwatch/metric-streams`.
3. The page says there is no screen yet.

## Expected
- The emulator's metric streams are listed; one opens on its page; a stream can be created, started, stopped and deleted.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether the emulator delivers anything to the stream's destination. Any engine change. Anything sent to real AWS.
