Issue-Id: 505
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs-delete-queue-dialog|message-count
Issue-Check-Ids:
Issue-Commit: 538f594dac81749ef4acd64e40b4fe2e232b2bc0

# Say how many messages a queue holds in SQS's delete-queue dialog

> Identified against commit `538f594dac81749ef4acd64e40b4fe2e232b2bc0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
SQS's delete-queue dialog (issue 490), opened by "Delete" on the queue list and by "Delete queue" on a queue's page,
says "The queue and every message in it are deleted from the local emulator. This cannot be undone." whatever the
queue holds: a queue with messages reads the same as an empty one, so the dialog does not say what is lost. Both
screens have already read the queue's counts (`GetQueueAttributes`: `ApproximateNumberOfMessages`,
`ApproximateNumberOfMessagesNotVisible`, `ApproximateNumberOfMessagesDelayed`) when the dialog opens. The same
request sent straight to aws-emulator, `aws sqs get-queue-attributes --attribute-names All`, gives those counts.

## Evidence
The impeccable critique of issue 489 at the point `final` (feat/489 at fbea0f6), P2:
`.pm/issue-489/review-final.md` ("The dialog does not say what is lost"), with the captures
`emuforge-489/output/captures/final-states/contact-sheet.png`. The dialog's body:
`studio/src/providers/aws/area/services/sqs/components/delete-queue-dialog.tsx:51`.

## Steps to Reproduce
1. Start a fresh emulator and Studio; create a queue `orders` and send it 3 messages (`aws sqs send-message`).
2. Open `/aws/sqs/queues`, select `orders`, press "Delete".
3. Read the dialog: it names no number of messages. Do the same with an empty queue: the same text.

## Expected
- The dialog of a queue the emulator reports messages for says how many it holds, as of the screen's last read.
- The dialog of a queue whose counts were not read (a row whose read failed) has no such sentence.
- The dialog of an empty queue does not claim messages.

## Out of scope
The confirmation word, the sentence on a dead-letter queue's sources, and reading the counts again when the dialog
opens.
