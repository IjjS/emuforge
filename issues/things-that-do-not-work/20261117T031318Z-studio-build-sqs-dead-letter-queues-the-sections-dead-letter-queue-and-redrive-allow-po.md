Issue-Id: 373
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|dead-letter-queues-and-redrive
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build SQS dead-letter queues: the sections "Dead-letter queue" and "Redrive allow policy" of "Create queue" and "Edit", and "Start DLQ redrive"

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The sections "Dead-letter queue" and "Redrive allow policy" are items of the reference spec `studio/references/console/sqs/create-queue.yaml` that issue 79 leaves unbuilt (two of its three unmatched items), and "Start DLQ redrive" on a queue's page leads to `/aws/sqs/queues/queue/<name>/dlq-redrive`, which shows the area's "no screen yet" page. The emulator stores both policies, moves messages to the dead-letter queue and runs message move tasks.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws sqs create-queue --queue-name q --attributes RedrivePolicy='{"deadLetterTargetArn":"<arn>","maxReceiveCount":"2"}'   -> 200; to a queue that does not exist   -> 400 "Dead letter target does not exist."
$ aws sqs set-queue-attributes ... RedrivePolicy=''   -> 200, the policy is gone; RedriveAllowPolicy stored and read back
$ a message received more than maxReceiveCount times   -> it is in the dead-letter queue
$ aws sqs list-dead-letter-source-queues --queue-url <dlq>   -> 200, the source queue
$ aws sqs start-message-move-task --source-arn <dlq arn>   -> 200, TaskHandle; the messages are back in the source queue at once
$ aws sqs list-message-move-tasks --source-arn <dlq arn>   -> 200, Status COMPLETED
$ aws sqs cancel-message-move-task of a completed task   -> 400
$ aws sqs delete-queue of the dead-letter queue   -> 200; the source queue keeps its RedrivePolicy
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/sqs/queues/create`.
3. There is no section "Dead-letter queue" and none named "Redrive allow policy".

## Expected
- "Create queue" and "Edit" have both sections and send them; the spec's two items match.
- A dead-letter queue's page lists its source queues; "Start DLQ redrive" starts a task to the source queues or a destination, its tasks are listed with their status, and "Cancel DLQ redrive" is offered while one runs. The emulator's answer is shown for each.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Access policy. Send and receive messages. Any engine change. Anything sent to real AWS.
