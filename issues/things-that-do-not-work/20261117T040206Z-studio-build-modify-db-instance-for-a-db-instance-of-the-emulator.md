Issue-Id: 403
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|modify-instance
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Build "Modify DB instance" for a DB instance of the emulator

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Modify" on the Databases list and on a DB instance's page (issue 245) leads to `/aws/rds/databases/instance/<id>/modify`, which shows the area's "no screen yet" page. The user guide's page is "Modify DB instance" with "Continue", a summary of the modifications, "Apply immediately" and "Modify DB instance". The emulator answers `ModifyDBInstance`.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds modify-db-instance --db-instance-class db.t3.medium --allocated-storage <larger> --no-apply-immediately   -> ok; the class and the storage stay in PendingModifiedValues
$ aws rds modify-db-instance ... --backup-retention-period <n> --no-apply-immediately   -> ok; applied at once
$ aws rds modify-db-instance --db-instance-class db.t3.medium --apply-immediately   -> ok; the class is read back
$ aws rds modify-db-instance --new-db-instance-identifier <new> --apply-immediately   -> ok; the old identifier answers DBInstanceNotFound
$ aws rds modify-db-instance --allocated-storage <smaller>   -> refused
$ aws rds modify-db-instance --no-deletion-protection --apply-immediately   -> ok
$ aws rds modify-db-instance on a stopped instance   -> InvalidDBInstanceState
$ aws rds describe-valid-db-instance-modifications   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a DB instance with the AWS CLI (`aws rds create-db-instance`).
2. Open `/aws/rds/databases`.
3. Select the row and choose "Modify".
4. The page says there is no screen yet.

## Expected
- The page shows the instance's settings the emulator stores and sends the changed ones with `ModifyDBInstance`, with or without "Apply immediately"; the list and the instance's page then show what the emulator returns, pending values included.
- The emulator's refusal (smaller storage, a stopped instance) is shown as it came.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Settings the requirement finds the emulator does not store. DB clusters. Any engine change. Anything sent to real AWS.
