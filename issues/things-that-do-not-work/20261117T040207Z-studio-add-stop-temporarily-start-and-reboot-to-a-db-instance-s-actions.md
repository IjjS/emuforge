Issue-Id: 404
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|instance-stop-start-reboot
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Add "Stop temporarily", "Start" and "Reboot" to a DB instance's "Actions"

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Actions" on the Databases list (issue 245) has the one entry "Delete". The user guide names "Stop temporarily" (the window "Stop DB instance temporarily"), "Start" and "Reboot" (with "Reboot with failover?"). The emulator moves an instance through those statuses.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds stop-db-instance   -> ok, DBInstanceStatus stopping; stopped about 1 s later
$ aws rds start-db-instance   -> ok, starting, then available
$ aws rds reboot-db-instance   -> ok, rebooting, then available
$ aws rds stop-db-instance on a stopped instance; start-db-instance on an available one   -> InvalidDBInstanceState
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a DB instance with the AWS CLI (`aws rds create-db-instance`).
2. Open `/aws/rds/databases`.
3. Select the row and open "Actions".
4. The menu holds "Delete" only.

## Expected
- "Actions" offers the three actions, each with the console's dialog; the row follows the status until it settles, without a refresh; an action in a wrong state shows the emulator's refusal as it came.
- The page of a DB instance gets its "Actions" once a capture shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Stopping and starting a DB cluster (the cluster issue). Any engine change. Anything sent to real AWS.
