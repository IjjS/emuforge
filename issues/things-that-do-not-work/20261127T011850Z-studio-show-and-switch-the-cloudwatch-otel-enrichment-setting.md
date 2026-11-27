Issue-Id: 668
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|otel-enrichment
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Show and switch the CloudWatch OTel enrichment setting

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
CloudWatch's OTel enrichment is an account setting, on or off. The emulator answers `GetOTelEnrichment`,
`StartOTelEnrichment` and `StopOTelEnrichment` with 200, and `UpdateOTelEnrichment` with 404 while it is off.
Studio's CloudWatch screens (issue 70) show the setting nowhere: it is no list, so it gave no entry, and no screen
reads it. The same requests sent straight to aws-emulator read and switch it.

## Evidence
aws-emulator 1.0.633, called directly on loopback while planning issue 70 (SDK `@aws-sdk/client-cloudwatch` 3.1161.0), each sent with an empty input:

```
GetOTelEnrichment	200	members: Status
StartOTelEnrichment	200	members: CreatedAt, UpdatedAt
StopOTelEnrichment	200	members: (none)
UpdateOTelEnrichment	404	ResourceNotFoundException: OTel enrichment is not enabled for this account
```

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Send `StartOTelEnrichment` to the emulator, then `GetOTelEnrichment`: it answers the status.
3. Look for the setting under `/aws/cloudwatch` in Studio: it is shown nowhere.

## Expected
- A CloudWatch screen shows whether OTel enrichment is on, read with `GetOTelEnrichment`.
- A developer can turn it on and off; the screen shows the status the read after the change gives.
- A refusal (as the 404 of `UpdateOTelEnrichment` while off) shows the operation's name and the emulator's reason.

## Out of scope
What enrichment does to metrics: the emulator's answer is shown, nothing is derived.
