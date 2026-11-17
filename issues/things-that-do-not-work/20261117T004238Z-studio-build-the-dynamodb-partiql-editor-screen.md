Issue-Id: 335
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|partiql-editor
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build the DynamoDB "PartiQL editor" screen

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/dynamodb/partiql` shows the area's "no screen yet" page. The emulator answers the PartiQL operations.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb execute-statement --statement 'SELECT * FROM "t"'   -> 200
$ aws dynamodb batch-execute-statement / execute-transaction   -> answered (200 or a 4xx of its own), none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with an item with the AWS CLI.
2. Open `/aws/dynamodb/partiql`.
3. The page says there is no screen yet.

## Expected
- A statement typed in the editor is sent to the emulator and its items or its refusal are shown; statements are never built from table data without the user.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Explore items (its own issue). Any engine change. Anything sent to real AWS.
