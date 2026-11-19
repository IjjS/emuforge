Issue-Id: 546
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.subscription|dead-letter-queue
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Show and set an SNS subscription's dead-letter queue

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 8 of SNS's task list (issue 536, `requirement.md`): a developer gives a subscription a dead-letter queue
and sees it. Studio's SNS screens as issue 536 built them (`studio/src/providers/aws/area/services/sns/`): the topics list `/aws/sns/topics`, a topic's page with "Subscriptions" and "Publish", "Create topic", "Create subscription" neither show nor set a subscription's `RedrivePolicy`. The reference is `aws sns
set-subscription-attributes --attribute-name RedrivePolicy` and `aws sns get-subscription-attributes` sent straight
to aws-emulator.

## Evidence

The probes of issue 536 (aws-emulator 1.0.515, `.pm/issue-536/probe/` in the main checkout, described in `.pm/issue-536/requirement.md`, "What the emulator supports"; kept with the issue's working files, summary `.pm/archive/536.md`): `probe-2.log`, "## a dead-letter queue of a subscription" (line 466): the `RedrivePolicy` is set and read
back; `probe-3.log`: what reaches the dead-letter queue when the endpoint's policy withholds the delivery. On
`feat/536` at the commit above no file under `studio/src/providers/aws/area/services/sns/` reads or writes
`RedrivePolicy`.

## Steps to Reproduce

1. Start a fresh emulator; create a topic and two queues; subscribe the first queue.
2. `aws sns set-subscription-attributes --subscription-arn <arn> --attribute-name RedrivePolicy --attribute-value '{"deadLetterTargetArn":"<the second queue's ARN>"}'`.
3. Open the topic's page in Studio, "Subscriptions": nothing shows the dead-letter queue.

## Expected

- A subscription's dead-letter queue is shown as the emulator reports it, and leads to that queue's page.
- It can be set and removed from Studio, and the emulator reports the change; a refusal is shown as it came.

## Out of scope

A queue's own dead-letter queue (SQS's). The filter policy and raw delivery (their own issue).
