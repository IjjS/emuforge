Issue-Id: 409
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|subnet-groups
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Build the "Subnet groups" screens

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/rds/subnet-groups` shows the area's "no screen yet" page (capture `docs/aws-console/rds/11-subnet-groups`). The emulator holds DB subnet groups, one named `default` from its start.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds describe-db-subnet-groups (fresh emulator)   -> ok, one group `default`
$ aws rds create-db-subnet-group; modify-db-subnet-group; delete-db-subnet-group   -> ok
$ aws ec2 describe-subnets   -> ok, three subnets of the default VPC
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/rds/subnet-groups`.
3. The page says there is no screen yet, and the side navigation "Aurora and RDS" has the one link "Databases".

## Expected
- The emulator's subnet groups are listed and opened; one can be created from the emulator's subnets, edited and deleted; the emulator's answer is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The VPC's own screens. Any engine change. Anything sent to real AWS.
