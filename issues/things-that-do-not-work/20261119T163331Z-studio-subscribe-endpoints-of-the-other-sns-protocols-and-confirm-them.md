Issue-Id: 548
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.subscription|other-protocols
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Subscribe endpoints of the other SNS protocols and confirm them

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 10 of SNS's task list (issue 536, `requirement.md`): a developer subscribes an endpoint of another
protocol (email, HTTP and HTTPS, SMS, Firehose, application) and confirms it. Studio's SNS screens as issue 536 built them (`studio/src/providers/aws/area/services/sns/`): the topics list `/aws/sns/topics`, a topic's page with "Subscriptions" and "Publish", "Create topic", "Create subscription": "Create subscription"
offers "Amazon SQS" and "AWS Lambda" only, with the queues and functions the emulator holds; a subscription of
another protocol made elsewhere is listed with "-" as its delivery and "Pending confirmation" where the emulator
says so, and Studio cannot confirm it. The reference is `aws sns subscribe --protocol <p>` and `aws sns
confirm-subscription` sent straight to aws-emulator.

## Evidence

The probes of issue 536 (aws-emulator 1.0.515, `.pm/issue-536/probe/` in the main checkout, described in `.pm/issue-536/requirement.md`, "What the emulator supports"; kept with the issue's working files, summary `.pm/archive/536.md`): `probe-1.log`, "## subscribe: what is refused" (from line 232; `--protocol email` at line 300, `--protocol
https` at line 306): the emulator accepts both and their subscriptions stay `PendingConfirmation`.
`ConfirmSubscription` was not called by the probes: the requirement of this issue starts by calling it. The check
`studio.sns-delivery-says-what-the-policy-allows` shows such a row as "Pending confirmation" and "-".

## Steps to Reproduce

1. Start a fresh emulator; create a topic.
2. Open "Create subscription" of the topic in Studio: the protocol choices are "Amazon SQS" and "AWS Lambda".
3. `aws sns subscribe --topic-arn <arn> --protocol email --notification-endpoint a@example.com`; the topic's page
   lists it as "Pending confirmation" with no way to confirm it.

## Expected

- An endpoint of each protocol the emulator accepts can be subscribed from Studio, and the emulator reports it.
- A pending subscription can be confirmed from Studio as far as the emulator's API allows; what the emulator does
  not implement is shown as not implemented.

## Out of scope

Mobile push's platform applications and text messaging (`Publish` to a phone number answers 501): no task of the
list.
