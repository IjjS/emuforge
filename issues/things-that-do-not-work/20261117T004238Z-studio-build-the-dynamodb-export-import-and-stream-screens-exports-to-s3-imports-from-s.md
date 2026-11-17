Issue-Id: 333
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb|exports-imports-streams
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build the DynamoDB export, import and stream screens: "Exports to S3", "Imports from S3", a table's "Exports and streams" tab

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A table's tab "Exports and streams" (issue 72) and the paths `/aws/dynamodb/exports` and `/aws/dynamodb/imports` show the area's "no screen yet" page. The emulator answers the export, import, stream and Kinesis destination operations.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb list-exports / list-imports   -> 200
$ aws dynamodb export-table-to-point-in-time / describe-export / import-table / describe-import   -> answered (200 or a 4xx of its own), none 501
$ aws dynamodb create-table ... --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE   -> 200, StreamSpecification and LatestStreamArn returned
$ aws dynamodbstreams list-streams / describe-stream   -> 200
$ aws dynamodb enable-kinesis-streaming-destination / describe-kinesis-streaming-destination / disable-kinesis-streaming-destination   -> answered, none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with the AWS CLI.
2. Open `/aws/dynamodb/tables` and the table's page.
3. Choose the tab "Exports and streams".
4. The page says there is no screen yet.

## Expected
- Exports and imports are listed and one can be started; a table's stream can be turned on and off and its details read; a Kinesis destination can be set and removed. The requirement finds out what the emulator does with an export's or import's S3 bucket.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Reading stream records. Backups. Any engine change. Anything sent to real AWS.
