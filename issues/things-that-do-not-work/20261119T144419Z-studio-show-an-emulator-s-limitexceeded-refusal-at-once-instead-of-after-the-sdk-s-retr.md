Issue-Id: 541
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|aws-client-retries-limit-exceeded|retry
Issue-Check-Ids:
Issue-Commit: 9bfa567e49544dec2549f2c64573be3db288e766

# Show an emulator's LimitExceeded refusal at once instead of after the SDK's retries

> Identified against commit `9bfa567e49544dec2549f2c64573be3db288e766`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The AWS SDK client Studio's area uses (from `studio/src/lib/aws`) retries an IAM refusal with the code
`LimitExceeded` (HTTP 409), which the SDK's standard retry strategy takes for throttling. The emulator answers it
when a role already holds ten managed policies. Studio therefore sends the same `AttachRolePolicy` three times and
shows the refusal only after the SDK's back-off, though the emulator's answer is final.

## Evidence

`studio/src/providers/aws/area/services/iam/components/attach-policies-dialog.test.tsx`, case "the second of three
refused …" (issue 535, s3): the fake engine answers `LimitExceeded` once per request and records three
`AttachRolePolicy` requests for the refused policy; the case waits up to 8 s for the dialog's refusal.

## Steps to Reproduce

1. A role with ten managed policies attached in the emulator.
2. On its page, "Attach policies", choose an eleventh, "Attach".
3. The engine's request log shows `AttachRolePolicy` for that policy three times; the refusal appears after a delay.

## Expected

A refusal of the emulator that is not a real throttle is shown after its one answer, the request sent once.

## Out of scope

How the dialogs of issue 535 word the refusal; that stays as it is.
