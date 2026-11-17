Issue-Id: 341
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|bulk-put-integrations-settings
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build the DynamoDB navigation's remaining screens: "Bulk put items", "Integrations", "Settings"

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's DynamoDB navigation has the entries "Bulk put items", "Integrations" and "Settings" (the owner's capture `docs/aws-console/dynamodbv2/03-tables`); Studio has no screen for any of them. What the emulator holds for each was not probed while planning issue 72; this issue's requirement finds it out first.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb batch-write-item   -> 200 (what "Bulk put items" would send)
$ aws dynamodb describe-limits   -> 200
$ aws dynamodb describe-endpoints   -> 200
Not called: anything for "Integrations" (zero-ETL and other services' APIs).
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/dynamodb/settings`.
3. The page says there is no screen yet.

## Expected
- The requirement states, per entry, what the emulator holds by calling it; an entry with resources of the emulator gets its screen, and one without is recorded as left out with the calls that show it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
"Reserved capacity": a purchase of capacity at a price, with no resource of the emulator's. Any engine change. Anything sent to real AWS.
