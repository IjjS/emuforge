Issue-Id: 506
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|sqs-create-queue-dead-letter-choices|stale-list
Issue-Check-Ids:
Issue-Commit: ae76c8b29b482fd7879c99bfbd6b0fa3d522287b

# Ask SQS's dead-letter choices again when the create form's list opens

> Identified against commit `ae76c8b29b482fd7879c99bfbd6b0fa3d522287b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
On SQS's "Create queue" (`/aws/sqs/queues/create`, issue 489), the dead-letter field's choices are read once for each
type and typed prefix while "Set a dead-letter queue" stays on. Opening the list again asks nothing: a queue created
since (by an app, the AWS CLI or another tab) is not offered until the search text changes, and a queue deleted
since, or every queue after the emulator restarted, is still offered. Choosing a queue that is gone is caught when
its ARN is read ("The queue is no longer in the emulator."), so nothing wrong is sent; the list is only out of date.
The same request sent straight to aws-emulator, `aws sqs list-queues`, answers the queues it holds at that moment.

## Evidence
The end review of issue 489, `.pm/issue-489/review-impl-r1.md`, P2:
`studio/src/providers/aws/area/services/sqs/pages/create-queue-page.tsx:455-463` (`onLoadItems` with `firstPage` and
an unchanged filter calls neither `refresh` nor `loadMore`) and `useDeadLetterChoices` in
`studio/src/providers/aws/area/services/sqs/queries.ts`.

## Steps to Reproduce
1. Start a fresh emulator and Studio; open `/aws/sqs/queues/create`, turn "Set a dead-letter queue" on and open the
   dead-letter list: "No standard queue in the emulator".
2. Close the list; `aws sqs create-queue --queue-name later` against the emulator.
3. Open the list again: `later` is not offered.

## Expected
- Opening the dead-letter list offers the queues of the chosen type the emulator holds at that moment.
- A queue deleted since the list was last open is no longer offered when it opens again.

## Out of scope
The ARN read on choosing, the type filter and the search by prefix.
