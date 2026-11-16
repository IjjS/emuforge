Issue-Id: 294
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|composite-alarms
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch composite alarm screens: create, edit and copy

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The alarm screens of issue 70 list composite alarms, show one on its page and delete one, but cannot create or change one: "Create composite alarm", and "Edit" and "Copy" of a composite alarm, lead to `/aws/cloudwatch/alarms/composite/create` and `/aws/cloudwatch/alarms/composite/<name>/edit`, which show the area's "no screen yet" page. The console has a wizard for a composite alarm (user guide, "Create a composite alarm") and shows an alarm's parent and child alarms.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-composite-alarm --alarm-name probe70-composite --alarm-rule 'ALARM("probe70-cpu") OR ALARM("probe70-custom")'
[exit 0]
$ aws cloudwatch put-composite-alarm --alarm-name probe70-composite-bad --alarm-rule 'ALARM("probe70-nope")'
ValidationError: Could not save the composite alarm as alarms [arn:aws:cloudwatch:us-east-1:000000000000:alarm:probe70-nope] in the alarm rule do not exist
$ aws cloudwatch describe-alarms --alarm-types CompositeAlarm   -> 200, CompositeAlarms with AlarmRule, StateValue
(a composite alarm followed its child alarm into ALARM)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create two metric alarms.
2. Open `/aws/cloudwatch/alarms`, select one, choose "Create composite alarm".
3. The page says there is no screen yet.

## Expected
- A composite alarm can be created from selected alarms, edited and copied in Studio; the emulator's `PutCompositeAlarm` answer, a refusal included, is shown.
- An alarm's page shows the composite alarms that name it and, for a composite alarm, the alarms its rule names.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Metric alarms (issue 70). Mute rules and the actions suppressor's own screens. Any engine change. Anything sent to real AWS.
