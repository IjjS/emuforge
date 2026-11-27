Issue-Id: 685
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|cloudwatch.alarm-form|description-optional-cue
Issue-Check-Ids:
Issue-Commit: f45fbbfb8dbdfae46a523bccc9414121d7832d68

# Mark the CloudWatch alarm form's Description as optional

> Identified against commit `f45fbbfb8dbdfae46a523bccc9414121d7832d68`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The Create alarm and Edit alarm forms (`/aws/cloudwatch/alarms/create`, `/aws/cloudwatch/alarms/edit?name=`) show the
Description field with its length rule only. Nothing says the field may be left empty, while the fields beside it
are required by the form's rules; a developer learns it only by saving. Reference: the same request sent straight
to aws-emulator, where `PutMetricAlarm` without `AlarmDescription` answers 200.

## Evidence
The impeccable critique of issue 70, second `final` on the built app of `feat/70` at `153662fa` (score 30/40), P3:
"[studio/src/providers/aws/area/services/cloudwatch/components/alarm-form.tsx:255] The Create form's Description
field gives its length constraint without an explicit optional cue."

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Open `/aws/cloudwatch/alarms/create`.
3. Read the Description field: its label and its constraint text do not say it is optional.

## Expected
- The Description field of the alarm form says it is optional, in its label or its hint, on Create and on Edit.
- An alarm saved with an empty description is still created with no `AlarmDescription`.

## Out of scope
Any other field of the form; the form's rules.
