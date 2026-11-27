Issue-Id: 693
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area.failure|sdk-filler-shown-as-reason
Issue-Check-Ids:
Issue-Commit: 0a2870b4329983575b2a7c0f78968376edf476b6

# Do not show the SDK's "UnknownError" as the emulator's reason for a refusal

> Identified against commit `0a2870b4329983575b2a7c0f78968376edf476b6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
When the emulator refuses a request with a code and no message, a screen of the AWS area shows the code followed by
"UnknownError", as if that were the emulator's reason. The word is not the emulator's: AWS's SDK puts it in the
place of a missing message, and the area's failure texts ("`{code}`: {message}") print it. Seen on the CloudWatch
alarm page: `SetAlarmState` on an alarm deleted meanwhile answers 404 with the body
`{"__type":"com.amazon.coral.service#ResourceNotFound"}`, and the dialog shows "SetAlarmState failed" with
"ResourceNotFound: UnknownError". Reference: the same request sent straight to aws-emulator, whose answer holds the
code alone. Whether the fault is one service's or the area's shared failure mapping is for the fix to trace.

## Evidence
The focused run of issue 70's integration checks on `feat/70` at `c7f0c76a` (emulator 1.0.639),
`studio.cloudwatch-set-state-runs-the-action`, second line: the alert's content was received as
"ResourceNotFound: UnknownError" while the direct call logged
`direct SetAlarmState was not refused with a code and a reason: 404 {"__type":"com.amazon.coral.service#ResourceNotFound"}`
(run of `3b6934a5`). The check on `feat/70` asserts what the screen shows today, the filler included
(`tests/integration/studio/services/cloudwatch/cloudwatch.ts`, `NO_REASON`).

## Steps to Reproduce
1. Start a fresh emulator and Studio on it; create a metric alarm.
2. Open the alarm's page and press "Set state".
3. Delete the alarm outside Studio (`DeleteAlarms`).
4. Choose a state in the dialog and confirm.
5. Read the alert in the dialog: "ResourceNotFound: UnknownError".

## Expected
- A refusal whose answer has no message is shown with its code alone (the area's `CodeAndMessage` already has that
  form), never with a word the emulator did not send.
- `studio.cloudwatch-set-state-runs-the-action` is changed with it, on the `pm`'s decision, to expect the code alone.

## Out of scope
The wording of refusals that do carry a message; the emulator's own answers.
