Issue-Id: 490
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|delete-queue
Issue-Check-Ids:
Issue-Commit: c1dc8cf4b31e234b1269b2d368271ef6041fa293

# Delete an SQS queue from Studio

> Identified against commit `c1dc8cf4b31e234b1269b2d368271ef6041fa293`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's SQS screens (issue 481: the queue list `/aws/sqs` and a queue's page `/aws/sqs/queues/queue/{name}`) read,
send, delete and purge messages, but offer no way to delete a queue. A developer who made a queue by mistake, or
wants a clean emulator between runs, must use the AWS CLI. The reference is `aws sqs delete-queue --queue-url …`
sent straight to aws-emulator, which answers 200 and drops the queue from `ListQueues`. This is task 8 of issue
481's task list (`.pm/issue-481/requirement.md`, "Tasks"); issues 371, 373 and 374 do not cover it.

## Evidence

- Issue 481's probe against aws-emulator 1.0.498, `.pm/issue-481/probe/probe.log` §7: `delete-queue` of
  `t-orders.fifo` answered with exit 0, and the next `list-queues` no longer listed it.
- Studio at `c1dc8cf`: `studio/src/providers/aws/area/services/sqs/api.ts` calls no `DeleteQueue`; neither page
  offers a delete action.

## Steps to Reproduce

1. Start the emulator and Studio; create a queue directly: `aws sqs create-queue --queue-name q1`.
2. Open `/aws/sqs`, then the queue's page.
3. Look for an action that deletes the queue: there is none.

## Expected

- The queue list and a queue's page offer "Delete" for a queue, confirmed in a dialog that names the queue.
- After confirming, the emulator's `ListQueues` no longer holds the queue, and Studio shows the list without it.
- The emulator's refusal (a queue already gone: `AWS.SimpleQueueService.NonExistentQueue`) is shown with its code
  and message, and nothing is reported as deleted.

## Out of scope

- Creating a queue (its own issue), changing settings (371), tags (371), the access policy (374).
