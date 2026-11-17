Issue-Id: 405
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|instance-tabs-and-tags
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Build a DB instance's tabs "Configuration", "Logs & events", "Maintenance & backups" and its "Tags"

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A DB instance's tabs "Logs & events", "Configuration" and "Maintenance & backups" (issue 245) lead to routes below `/aws/rds/databases/instance/<id>/` that show the area's "no screen yet" page, and the page has no "Tags" section (the user guide: "Tags" with "Add", the "Add tags" window and "Delete"). The emulator holds what they show.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds describe-events (after creating instances)   -> ok, events such as 'DB instance created'; pages with --max-records 20 and Marker
$ aws rds describe-db-log-files; aws rds download-db-log-file-portion   -> ok
$ aws rds add-tags-to-resource; list-tags-for-resource; remove-tags-from-resource   -> ok, the tags read back
$ aws rds describe-db-instances   -> ok, each instance with EngineVersion, DBInstanceClass, AllocatedStorage, StorageType, MasterUsername, DeletionProtection, TagList, PendingModifiedValues
$ aws rds describe-pending-maintenance-actions   -> ok, always empty
$ aws rds describe-db-instance-automated-backups   -> 501 NotImplemented
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a DB instance with the AWS CLI (`aws rds create-db-instance`).
2. Open `/aws/rds/databases`.
3. Open the instance and choose each of the three tabs.
4. Each page says there is no screen yet; the instance's page shows no tags.

## Expected
- Each tab shows what the emulator holds for it (configuration values, events and log files, backup settings); tags can be added and removed.
- A part whose operation answers 501 (the automated backups of an instance) says "not implemented", never an empty list.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Monitoring (the emulator's CloudWatch holds no metric of `AWS/RDS`). Any engine change. Anything sent to real AWS.
