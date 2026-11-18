Issue-Id: 372
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|send-and-receive-messages
Issue-Check-Ids: studio.sqs-queues-made-outside-are-listed-with-counts studio.sqs-routes-lead-to-the-queue-screens studio.sqs-queue-search-and-pages studio.sqs-read-messages-leaves-them-in-the-queue studio.sqs-read-on-a-redrive-queue-warns-and-moves studio.sqs-read-fifo-queue-shows-groups studio.sqs-send-message-reaches-the-emulator studio.sqs-send-fifo-message studio.sqs-delete-read-messages studio.sqs-purge-queue studio.sqs-redrive-dead-letters-back-to-their-source studio.sqs-redrive-to-another-queue-and-cancel studio.sqs-queue-gone-while-open studio.sqs-emulator-restart-shows-the-empty-emulator
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build the SQS "Send and receive messages" screen: send a message, poll for messages, read and delete them

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Send and receive messages" on the queue list and on a queue's page (issue 79) leads to `/aws/sqs/queues/queue/<name>/send-receive`, which shows the area's "no screen yet" page. The emulator holds messages.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws sqs send-message --queue-url <url> --message-body b [--delay-seconds n] [--message-attributes ...]   -> 200, MessageId; ApproximateNumberOfMessages / ...Delayed follow
$ aws sqs send-message to a FIFO queue without --message-group-id   -> 400; with a group and a deduplication ID (or content-based deduplication)   -> 200; with --delay-seconds   -> 400
$ aws sqs receive-message --queue-url <url> --max-number-of-messages 10 --wait-time-seconds 20   -> 200; a wait of 5 s and of 20 s is relayed by the engine (answers after 5008 ms and 20010 ms)
$ aws sqs delete-message / change-message-visibility / send-message-batch / delete-message-batch / change-message-visibility-batch   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a queue with the AWS CLI.
2. Open `/aws/sqs/queues` and select the queue.
3. Choose "Send and receive messages".
4. The page says there is no screen yet.

## Expected
- A message is sent with its body, delay, attributes and, for a FIFO queue, group and deduplication ID; "Poll for messages" receives with the wait the user sets and can be stopped; a received message's body and attributes are shown as text; messages can be deleted. The emulator's answer is shown for each.
- The screen says that receiving a message hides it from other consumers for the visibility timeout.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
DLQ redrive. Edit. Any engine change. Anything sent to real AWS.
