Issue-Id: 371
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|edit-queue
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build the SQS "Edit" screen: change a queue's configuration, encryption and tags

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Edit" on the queue list and on a queue's page (issue 79) leads to `/aws/sqs/queues/queue/<name>/edit`, which shows the area's "no screen yet" page. The emulator stores every attribute a queue can be given after creation, and its tags.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws sqs set-queue-attributes --queue-url <url> --attributes VisibilityTimeout=..,MessageRetentionPeriod=..,DelaySeconds=..,MaximumMessageSize=..,ReceiveMessageWaitTimeSeconds=..   -> 200, read back by get-queue-attributes; LastModifiedTimestamp moves
$ aws sqs set-queue-attributes ... KmsMasterKeyId=alias/x   -> 200, SqsManagedSseEnabled reads back false; ... SqsManagedSseEnabled=true   -> 200, the KMS key is gone
$ aws sqs set-queue-attributes ... FifoQueue=true   -> 400 "Unknown Attribute FifoQueue"
$ aws sqs set-queue-attributes with a value outside its bounds   -> 400 InvalidAttributeValue
$ aws sqs tag-queue / untag-queue / list-queue-tags   -> 200; a tag with an empty value is kept; more than 50 tags refused
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a queue with the AWS CLI.
2. Open `/aws/sqs/queues` and select the queue.
3. Choose "Edit".
4. The page says there is no screen yet.

## Expected
- The form shows the queue's current configuration, encryption and tags, and "Save" sends only what changed; the emulator's answer, a refusal included, is shown, and the queue's page shows the new values.
- The queue's type and name cannot be changed, and the form says so.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The sections "Dead-letter queue", "Redrive allow policy" and "Access policy" (their own issues). Any engine change. Anything sent to real AWS.
