Issue-Id: 555
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|sqs-checks|list-h1-matched-exactly-races-the-list-read
Issue-Check-Ids:
Issue-Commit: ec8a9a9ee055e5466df8afcdec0b666c0c7ff784

# Find the queue list's h1 with its counter in the SQS checks

> Identified against commit `ec8a9a9ee055e5466df8afcdec0b666c0c7ff784`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The SQS checks find the queue list's `h1` as exactly "Queues" (`heading(page, LIST_H1)` of `support/frame.ts`, and
`open` of `tests/integration/studio/services/sqs/`). The list's header gives Cloudscape's `Header` a `counter` once
the list is read (`studio/src/providers/aws/area/services/sqs/pages/queue-list-page.tsx:438`), and Cloudscape renders
the counter inside the `h1`, so the `h1` reads "Queues" only while the list is being read and "Queues (2)" after. A
check that asks after the read has ended fails. This is the fault that failed
`studio.sns-topics-made-elsewhere-are-shown` on GitHub Actions (issue 551); the SQS checks pass today because they
happen to ask before the read ends. It is most exposed after a navigation inside the app:
`sqs-queue-list.spec.ts:177` (after `goBack`) and `sqs-queue-delete.spec.ts:97` (after "Delete").

The screens are right. IAM's checks (`^Roles(\s|$)`), DynamoDB's (`h1` of `services/dynamodb/dynamodb.ts`) and, since
issue 551, SNS's (`listHeading`) allow the counter.

## Evidence

Issue 551: `.pm/issue-551/requirement.md` section 2 and `.pm/issue-551/evidence/sns-topics-h1-once-the-list-is-read.log`
(the same header and the same matcher, failing once the list is read). The SQS lines named above.

## Steps to Reproduce

In `sqs-queue-delete.spec.ts`, before line 97, wait for a row of the list; the `h1` then reads "Queues (n)" and the
line fails.

## Expected

The SQS checks find the list's `h1` whether or not the list is read; every other heading stays matched exactly. A
check merged with its issue is changed on the `pm`'s decision.

## Out of scope

The screens.
