Issue-Id: 489
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|create-queue
Issue-Check-Ids: studio.sqs-create-standard-queue studio.sqs-create-fifo-queue-with-a-dead-letter-queue studio.sqs-create-queue-name-already-taken studio.sqs-create-queue-dead-letter-queue-gone
Issue-Commit: c1dc8cf4b31e234b1269b2d368271ef6041fa293

# Create an SQS queue from Studio: standard or FIFO, with a dead-letter queue

> Identified against commit `c1dc8cf4b31e234b1269b2d368271ef6041fa293`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's SQS screens (issue 481) show the queues an app or a tool created, but Studio cannot create one. The
reference is `aws sqs create-queue` sent straight to aws-emulator: a standard queue, a FIFO queue
(`FifoQueue=true`, its name ending `.fifo`, with or without `ContentBasedDeduplication`), and a queue whose
`RedrivePolicy` names a dead-letter queue and a `maxReceiveCount`. This is task 6 of issue 481's task list
(`.pm/issue-481/requirement.md`, "Tasks"). Issue 373 covers the dead-letter section of a create form; the pm
decides whether this issue and 373 are cut again (requirement, "Tasks 6 to 10 go to later issues").

## Evidence

- Issue 481's probe against aws-emulator 1.0.498, `.pm/issue-481/probe/probe.log` §1: `create-queue` of a
  standard queue with `VisibilityTimeout=30`, of `t-orders.fifo` with `FifoQueue=true,ContentBasedDeduplication=true`,
  of a dead-letter queue, and of a source whose `RedrivePolicy` names it, each answered with its `QueueUrl`, and
  `list-queues` listed all four.
- Studio at `c1dc8cf`: `studio/src/providers/aws/area/services/sqs/api.ts` calls no `CreateQueue`; `/aws/sqs` has
  no create action.

## Steps to Reproduce

1. Start the emulator and Studio, and open `/aws/sqs`.
2. Look for an action that creates a queue: there is none.

## Expected

- `/aws/sqs` offers "Create queue": a name, the type (Standard or FIFO; a FIFO name must end `.fifo`), content-based
  deduplication for FIFO, and optionally a dead-letter queue chosen from the emulator's queues with a maximum
  receive count.
- After creating, the emulator's `GetQueueAttributes` of the new queue reports the type, the deduplication setting
  and the `RedrivePolicy` given, and Studio leads to the queue's page.
- The emulator's refusals (a name already used with other attributes, an invalid name) are shown with their code
  and message, and nothing is reported as created.

## Out of scope

- Every other setting of a queue (371), its access policy (374), deleting a queue (its own issue).
