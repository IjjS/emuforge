Issue-Id: 415
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|navigation-remaining
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Find out what the emulator holds for the rest of the Aurora and RDS navigation and build what it has

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation "Aurora and RDS" has the entries Dashboard, Query editor, CloudWatch Database Insights, Exports in Amazon S3, Automated backups, Reserved instances, Capacity reservations, Custom engine versions, Zero-ETL integrations and Certificate update (the owner's captures under `docs/aws-console/rds/`); Studio's navigation (issue 245) has the one link "Databases". Planning issue 245 called only the first operations of each; this issue's requirement finds out what the emulator holds for each and builds the screens it can fill, each entry its own screen.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds describe-account-attributes   -> ok, quotas (DBInstances Max 40)
$ aws rds describe-certificates; modify-certificates   -> ok
$ aws rds describe-export-tasks   -> ok, empty; start-export-task with a bucket the emulator does not hold -> InvalidS3BucketFault
$ aws rds describe-integrations   -> ok, empty; create-integration -> ok
$ aws rds describe-db-cluster-automated-backups   -> ok; describe-db-instance-automated-backups -> 501 NotImplemented
$ aws rds describe-blue-green-deployments   -> ok, empty; create-blue-green-deployment -> ok
$ aws rds describe-reserved-db-instances; describe-reserved-db-instances-offerings; purchase-reserved-db-instances-offering   -> 501 NotImplemented
$ aws rds create-custom-db-engine-version --engine custom-oracle-ee   -> refused, "Invalid DB engine"
$ aws rds describe-source-regions   -> 501 NotImplemented
$ aws cloudwatch list-metrics --namespace AWS/RDS   -> ok, no metric
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/rds/dashboard`.
3. The page says there is no screen yet, and the side navigation "Aurora and RDS" has the one link "Databases".

## Expected
- For each entry the requirement states, by calling, whether the emulator can hold what the screen shows; an entry it can fill gets its screen, and an entry it cannot is recorded with the calls that show it (an operation answered 501, or nothing the screen shows can be created).
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Entries that have their own issue (Snapshots, Proxies, Subnet groups, Parameter groups, Option groups, Events, Event subscriptions, Recommendations). Any engine change. Anything sent to real AWS.
