Issue-Id: 408
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|snapshots
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Build the "Snapshots" screens: take, copy, restore and delete a DB snapshot, cluster snapshots, read replicas

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/rds/snapshots` shows the area's "no screen yet" page (the console's navigation entry "Snapshots", capture `docs/aws-console/rds/05-snapshots`). A final snapshot the delete dialog of issue 245 makes can be seen nowhere in Studio. The emulator holds snapshots and read replicas.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds create-db-snapshot; describe-db-snapshots   -> ok (available, manual)
$ aws rds copy-db-snapshot; delete-db-snapshot   -> ok
$ aws rds restore-db-instance-from-db-snapshot   -> ok
$ aws rds create-db-cluster-snapshot; describe-db-cluster-snapshots   -> ok
$ aws rds create-db-instance-read-replica; promote-read-replica   -> ok (the source is gone from the replica after the promotion)
$ aws rds modify-db-snapshot-attribute   -> 501 NotImplemented
$ aws rds restore-db-instance-to-point-in-time   -> 501 NotImplemented
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/rds/snapshots`.
3. The page says there is no screen yet, and the side navigation "Aurora and RDS" has the one link "Databases".

## Expected
- The emulator's DB snapshots and cluster snapshots are listed; a snapshot can be taken from an instance, copied, restored to a new instance and deleted; a read replica can be created and promoted; the emulator's answer is shown.
- Sharing a snapshot and restoring to a point in time say "not implemented" while the emulator answers 501.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Exports to S3. Automated backups. Any engine change. Anything sent to real AWS.
