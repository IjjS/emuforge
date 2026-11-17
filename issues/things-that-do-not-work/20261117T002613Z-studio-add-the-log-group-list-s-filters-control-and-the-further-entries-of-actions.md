Issue-Id: 324
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs.log-group-list|filters-and-actions
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Add the log group list's "Filters" control and the further entries of "Actions"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's log group list has a button "Filters" and an "Actions" menu with more entries than the "Edit deletion protection" the user guide names. Studio's list (issue 71) has no "Filters" control, and its "Actions" offers "Edit deletion protection" and "Delete log group" only. The emulator answers operations such entries could use (`DescribeLogGroups` with `logGroupClass`, `PutBearerTokenAuthentication`, `CreateExportTask` is known to it). The owner's capture `docs/aws-console/cloudwatch/28-log-management` shows both closed and the user guide lists no further entry, so the console's labels cannot be pointed to yet: this issue needs captures of the open "Filters" control and "Actions" menu under `docs/aws-console/cloudwatch/` before its spec items can be written (issue 71, `decisions-needed.md` question 3).

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs describe-log-groups --log-group-class DELIVERY   -> 200, only the Delivery group
$ aws logs put-bearer-token-authentication …   -> 200; describe-log-groups reads bearerTokenAuthenticationEnabled true
sweep with an empty body: 400  CreateExportTask  InvalidParameterException … 'logGroupName' … (known, not 501)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create two log groups.
2. Open `/aws/logs/log-groups` and select one.
3. There is no "Filters" control, and "Actions" offers "Edit deletion protection" and "Delete log group" only.

## Expected
- "Filters" narrows the list by what its entries name, by asking the emulator, not by filtering a page in the browser.
- "Actions" has the console's further entries, each sending its operation and showing the emulator's answer.
- The labels are the console's, word for word, from a capture.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Sorting. Entries that belong to another filed issue's resource (metric filters, subscription filters, anomaly detection, data protection, export). Any engine change. Anything sent to real AWS.
