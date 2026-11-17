Issue-Id: 301
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch.alarm-list|quick-filters-and-actions
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Add the CloudWatch alarm list's "Quick filters" and the further entries of "Actions"

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's alarm list has a control "Quick filters" (a multiselect named "Quick filters for alarms") and an "Actions" menu with more entries than the "Edit", "Copy" and "Delete" the user guide names. Studio's alarm list (issue 70) has neither the control nor those entries. The emulator answers the operations behind them: `DescribeAlarms` filtered by `StateValue` (also combined with a name prefix), `EnableAlarmActions`, `DisableAlarmActions`, `SetAlarmState`. The owner's capture `docs/aws-console/cloudwatch/04-alarms` shows both menus closed and the user guide lists no entry, so the console's labels of the entries cannot be pointed to yet: this issue needs captures of the open "Quick filters" and "Actions" menus under `docs/aws-console/cloudwatch/` before its spec items can be written (issue 70, `decisions-needed.md` question 3).

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch describe-alarms --alarm-types CompositeAlarm MetricAlarm --alarm-name-prefix p70-a --state-value INSUFFICIENT_DATA   -> 200, only the alarms in that state whose name starts with p70-a
$ aws cloudwatch disable-alarm-actions --alarm-names probe70-cpu   -> 200, read back ActionsEnabled false
$ aws cloudwatch enable-alarm-actions --alarm-names probe70-cpu    -> 200, read back ActionsEnabled true
$ aws cloudwatch set-alarm-state --alarm-name probe70-cpu --state-value ALARM --state-reason probe   -> 200, read back ALARM, a StateUpdate item in its history
```

The captures `docs/aws-console/cloudwatch/05-0.mhtml` and `07-0.mhtml` already hold part of the answer: the list's
"Filter alarms" control is a property filter, shown there with the tokens "State = Alarm" and "State =
Insufficient data", each followed by "Clear filters", and their addresses carry `alarmListFilter` with
`propertyKey` `alarmState`. Issue 70 builds the property filter with free text only; the state property and its
tokens are this issue's.

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create two alarms, one set to ALARM with `SetAlarmState`.
2. Open `/aws/cloudwatch/alarms`.
3. There is no "Quick filters" control, and "Actions" offers "Edit", "Copy" and "Delete" only.

## Expected
- "Quick filters" narrows the list by what its entries name, by asking the emulator, not by filtering a page in the browser.
- "Actions" has the console's further entries, each sending its operation and showing the emulator's answer.
- The labels are the console's, word for word, from a capture.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The mute entries of "Actions" (the mute rules issue). Sorting. The counts by state in the navigation (#47). Any engine change. Anything sent to real AWS.
