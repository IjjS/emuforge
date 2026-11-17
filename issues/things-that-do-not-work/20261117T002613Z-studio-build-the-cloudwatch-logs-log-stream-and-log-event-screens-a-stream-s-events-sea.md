Issue-Id: 316
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|log-streams-and-events
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs log stream and log event screens: a stream's events, search, create and delete a stream

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A log group's page (issue 71) lists its log streams read-only. A stream's name leads to `/aws/logs/log-groups/log-group/<name>``/log-events/<stream>` and "Search log group" to `/aws/logs/log-groups/log-group/<name>``/log-events`, which show the area's "no screen yet" page; a stream cannot be created or deleted in Studio, and the streams table has no filter. The emulator holds streams and their events.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs create-log-stream --log-group-name p71-s --log-stream-name stream-a
[exit 0]
$ aws logs create-log-stream --log-group-name p71-s --log-stream-name stream-a
ResourceAlreadyExistsException: The specified log stream already exists
$ aws logs put-log-events --log-group-name p71-s --log-stream-name stream-b --log-events '[{"timestamp":1794874398000,"message":"hello from p71"}, …]'
{"nextSequenceToken":"0…02"}
$ aws logs get-log-events --log-group-name p71-s --log-stream-name stream-b   -> 200, events with timestamp, message, ingestionTime, nextForwardToken, nextBackwardToken
$ aws logs filter-log-events --log-group-name p71-a-standard --filter-pattern error   -> 200, events, searchedLogStreams
$ aws logs describe-log-streams --log-group-name p71-s --order-by LastEventTime --descending   -> 200
$ aws logs describe-log-streams --log-group-name p71-s --log-stream-name-prefix stream --order-by LastEventTime
InvalidParameterException: Cannot order by LastEventTime with a logStreamNamePrefix.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group, a log stream and put two events with the AWS CLI.
2. Open the log group's page in Studio and choose the stream's name.
3. The page says there is no screen yet.

## Expected
- A log stream's events are shown, paged by the API's tokens; "Search log group" searches a group's events with `FilterLogEvents`.
- A log stream can be created and deleted; the streams table can be filtered by a name prefix by asking the emulator.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The log group's own screens (issue 71). Logs Insights and Live Tail (their own issues). Any engine change. Anything sent to real AWS.
