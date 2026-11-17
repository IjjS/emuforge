Issue-Id: 349
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|event-source-mappings
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build the Lambda "Event source mappings" screens and a function's triggers

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/lambda/event-source-mappings` shows the area's "no screen yet" page, and a function's page (issue 84) shows no trigger. The emulator answers the event source mapping operations and checks the function's execution role before it creates one; no mapping was created while planning issue 84, so this issue's requirement first creates one with a role that holds the source's permissions.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda list-event-source-mappings   -> ok, empty
$ aws lambda list-event-source-mappings --function-name p84-a   -> ok, empty
$ aws lambda create-event-source-mapping --function-name p84-a --event-source-arn arn:aws:sqs:us-east-1:000000000000:p84-queue --batch-size 5 (the queue exists; the role has no policy)   -> InvalidParameterValueException "The function execution role does not have permissions to call ReceiveMessage on SQS"
$ aws lambda get-event-source-mapping --uuid None   -> ValidationException (the constraint of `uUID`)
Not called: a mapping created with a role that may read the queue, and get, update and delete of it.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/lambda/event-source-mappings`.
3. The page says there is no screen yet.

## Expected
- The requirement states by calling what the emulator does with a mapping (whether it is kept, and whether a message of the source invokes the function); the emulator's mappings are listed, for all functions and for one; a mapping can be created, turned off and on, and deleted; the emulator's refusal for a role without the source's permissions is shown as it came.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The source services' own screens (SQS, Kinesis, DynamoDB streams). Any engine change. Anything sent to real AWS.
