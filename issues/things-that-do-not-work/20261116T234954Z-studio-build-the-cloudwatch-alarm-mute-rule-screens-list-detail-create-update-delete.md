Issue-Id: 295
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|alarm-mute-rules
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch alarm mute rule screens: list, detail, create, update, delete

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The alarm list's tab "Mute rules" leads to `/aws/cloudwatch/alarms/mute-rules`, which shows the area's "no screen yet" page, and the mute entries of the list's "Actions" menu with their dialogs ("Apply mute rules to this alarm", "Mute until") are not there. The emulator holds mute rules; the alarm screens of issue 70 only read them for the column "Actions muted".

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-alarm-mute-rule --name probe70-mute --description probe --rule 'Schedule={Expression="cron(0 2 * * *)",Duration=PT1H}' --mute-targets 'AlarmNames=[probe70-cpu]'
[exit 0]
$ aws cloudwatch list-alarm-mute-rules      -> 200, AlarmMuteRuleSummaries with the rule's ARN, Status, MuteType
$ aws cloudwatch get-alarm-mute-rule --alarm-mute-rule-name probe70-mute   -> 200 with MuteTargets.AlarmNames
$ aws cloudwatch delete-alarm-mute-rule --alarm-mute-rule-name probe70-mute
NotImplemented (HTTP 501): operation DeleteAlarmMuteRule is scaffolded but not implemented in this emulator
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator, create an alarm and a mute rule with the AWS CLI.
2. Open `/aws/cloudwatch/alarms` and choose the tab "Mute rules".
3. The page says there is no screen yet.

## Expected
- The tab "Mute rules" lists the emulator's mute rules; a rule has its page; a rule can be created and updated; the list's mute entries of "Actions" exist with their dialogs.
- Delete stays on the screen and reports the emulator's 501 as "not implemented" while `DeleteAlarmMuteRule` answers it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The alarm list's column "Actions muted" (issue 70). Any engine change. Anything sent to real AWS.
