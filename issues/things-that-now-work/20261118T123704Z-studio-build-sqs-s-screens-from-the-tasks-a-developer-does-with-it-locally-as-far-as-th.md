Issue-Id: 481
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|sqs|tasks-by-the-emulator-api
Issue-Check-Ids: studio.sqs-queues-made-outside-are-listed-with-counts studio.sqs-routes-lead-to-the-queue-screens studio.sqs-queue-search-and-pages studio.sqs-read-messages-leaves-them-in-the-queue studio.sqs-read-on-a-redrive-queue-warns-and-moves studio.sqs-read-fifo-queue-shows-groups studio.sqs-send-message-reaches-the-emulator studio.sqs-send-fifo-message studio.sqs-delete-read-messages studio.sqs-purge-queue studio.sqs-redrive-dead-letters-back-to-their-source studio.sqs-redrive-to-another-queue-and-cancel studio.sqs-queue-gone-while-open studio.sqs-emulator-restart-shows-the-empty-emulator studio.sqs-read-on-a-redrive-queue-after-a-consumer-took-them studio.sqs-read-on-a-redrive-queue-of-more-than-ten studio.sqs-redrive-of-several-sources-asks-for-a-queue
Issue-Commit: 6859ed2abb063e63a71abbc420aa0020bf4a3c48

# Build SQS's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `6859ed2abb063e63a71abbc420aa0020bf4a3c48`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's pilot of the method of issue 478, as issue 480 for S3. SQS has no screen on `main`. What a developer
does with SQS locally: see how many messages a queue holds, send a test message, receive one and read its body and
attributes, delete or purge, see what fell into a dead-letter queue and redrive it, look at a queue's settings.
Issue 79 planned and began SQS the old way (list, page, create form); its branches `feat/79` and its units keep
check support for queues (`tests/integration/studio/services/sqs/`, tried against an emulator: direct calls send
`x-amzn-query-mode`; a KMS queue takes its key after messages are sent) and may be taken from. Issue 372 (send and
receive messages) is one of the tasks.

This issue plans SQS anew by its tasks, writes the task list first and stops for the owner to read it, then builds
from the top.

## Evidence

The owner's decisions of 2026-11-18. Issue 79's `.pm/issue-79/` (its requirement's probes of the emulator) and
branches.

## Steps to Reproduce

Open `/aws/sqs`: "No screen yet".

## Expected

A developer who runs an app against the local emulator can do, in Studio, the service's core tasks from start to
end, each proven by a business scenario against the real emulator.

## Out of scope
