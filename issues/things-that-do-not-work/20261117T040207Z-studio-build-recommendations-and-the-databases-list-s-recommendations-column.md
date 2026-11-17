Issue-Id: 414
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|recommendations
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Build "Recommendations" and the Databases list's "Recommendations" column

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/rds/recommendations` shows the area's "no screen yet" page (capture `docs/aws-console/rds/18-recommendations`), and the column "Recommendations" of the Databases list (issue 245) reads "-" in every row. The emulator makes recommendations for the instances and clusters it holds.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds describe-db-recommendations (28 instances and 2 clusters held)   -> ok, 100 recommendations on the first page; each with RecommendationId, TypeId (deletion-protection-turned-off, enhanced-monitoring-turned-off, performance-insights-turned-off, publicly-accessible, single-az-deployment, storage-not-encrypted), Severity, ResourceArn, Status active, Category
$ aws rds describe-db-recommendations --filters Name=resource-arn,Values=<arn>   -> refused, "Unrecognized filter name"
$ aws rds describe-db-recommendations (after a restart)   -> ok, none
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a DB instance with the AWS CLI (`aws rds create-db-instance`).
2. Open `/aws/rds/databases`.
3. The column "Recommendations" reads "-"; `/aws/rds/recommendations` says there is no screen yet.

## Expected
- The emulator's recommendations are listed with paging; the requirement decides, by calling, how the list's column can show an instance's recommendations without loading every page (the emulator refuses the filter by resource), or records that it cannot.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Applying a recommendation, unless the requirement finds the emulator answers `ModifyDBRecommendation`. Any engine change. Anything sent to real AWS.
