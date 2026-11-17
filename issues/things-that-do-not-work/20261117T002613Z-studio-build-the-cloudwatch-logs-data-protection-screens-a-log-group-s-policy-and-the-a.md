Issue-Id: 320
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|data-protection
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs data protection screens: a log group's policy and the account's

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The log group list and a log group's page (issue 71) show a group's data protection status, but nothing shows, creates, changes or deletes a data protection policy. The emulator holds the policies and masks with them.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs put-data-protection-policy --log-group-identifier p71-s --policy-document '{"Name":"p71-dp","Version":"2021-06-01","Statement":[audit EmailAddress, deidentify EmailAddress]}'
200 with the policy; describe-log-groups then reads dataProtectionStatus ACTIVATED
$ aws logs get-data-protection-policy --log-group-identifier p71-s   -> 200 with policyDocument
$ aws logs get-log-events ... (an event "again someone@example.com" put after the policy)
"message":"again *******************"
$ aws logs delete-data-protection-policy --log-group-identifier p71-s   -> 200; dataProtectionStatus DELETED
$ aws logs describe-account-policies --policy-type DATA_PROTECTION_POLICY   -> 200, accountPolicies []
$ aws cloudwatch list-metrics --namespace AWS/Logs   -> IncomingBytes, IncomingLogEvents only (no LogEventsWithFindings)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group and put a data protection policy on it with the AWS CLI.
2. Open the log group's page in Studio.
3. "Data protection" reads "Activated" and nothing shows the policy.

## Expected
- A log group's data protection policy is shown on its page and can be created, changed and deleted; the account's policy likewise.
- The list's column "Sensitive data count" and the dialog "Reset data protection alert for all log groups?" stay out while the emulator produces no count of findings; the requirement probes it again.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Unmasking events (with the log events issue). Any engine change. Anything sent to real AWS.
