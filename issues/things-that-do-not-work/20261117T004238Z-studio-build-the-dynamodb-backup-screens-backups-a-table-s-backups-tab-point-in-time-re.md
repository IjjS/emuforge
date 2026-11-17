Issue-Id: 332
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|backups-and-pitr
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build the DynamoDB backup screens: backups, a table's "Backups" tab, point-in-time recovery

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's tab "Backups" (issue 72) leads to `/aws/dynamodb/tables/table/<name>/backups` and `/aws/dynamodb/backups` both show the area's "no screen yet" page; a table's page shows point-in-time recovery as "On" or "Off" and cannot change it. The emulator holds backups and the point-in-time recovery setting.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb create-backup --table-name t --backup-name b   -> 200
$ aws dynamodb list-backups / describe-backup / delete-backup   -> 200
$ aws dynamodb restore-table-from-backup / restore-table-to-point-in-time   -> answered (200 or a 4xx of its own), none 501
$ aws dynamodb describe-continuous-backups --table-name t   -> 200, PointInTimeRecoveryStatus DISABLED for a new table
$ aws dynamodb update-continuous-backups --table-name t --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true   -> 200, read back ENABLED
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Backups".
4. The page says there is no screen yet.

## Expected
- The emulator's backups are listed, for all tables and for one; a backup can be created, restored to a new table and deleted; point-in-time recovery can be turned on and off and a table restored to a point in time.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
AWS Backup's own plans. Exports. Any engine change. Anything sent to real AWS.
