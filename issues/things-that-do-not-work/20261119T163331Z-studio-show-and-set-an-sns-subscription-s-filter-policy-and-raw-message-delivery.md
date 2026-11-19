Issue-Id: 545
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.subscription|filter-policy-and-raw-delivery
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Show and set an SNS subscription's filter policy and raw message delivery

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 7 of SNS's task list (issue 536, `requirement.md`, "Tasks, in order of importance"): a developer sets a
subscription's filter policy or raw message delivery and sees them. Studio's SNS screens as issue 536 built them (`studio/src/providers/aws/area/services/sns/`): the topics list `/aws/sns/topics`, a topic's page with "Subscriptions" and "Publish", "Create topic", "Create subscription" list a subscription with its protocol,
endpoint, status and delivery only: a subscription made elsewhere with a filter policy or raw delivery looks like
any other, and Studio can set neither. A filter policy that does not match withholds a notification silently, the
same way a missing queue policy does, so a developer who publishes from Studio and finds the queue empty has no
screen that says why. The reference is the same request sent straight to aws-emulator: `aws sns
get-subscription-attributes` and `aws sns set-subscription-attributes` (`FilterPolicy`, `FilterPolicyScope`,
`RawMessageDelivery`).

## Evidence

The probes of issue 536 (aws-emulator 1.0.515, `.pm/issue-536/probe/` in the main checkout, described in `.pm/issue-536/requirement.md`, "What the emulator supports"; kept with the issue's working files, summary `.pm/archive/536.md`): `probe-1.log`, "## raw message delivery" (line 582) and "## filter policy" (line 640): both attributes are
set and read back, and what the emulator refuses is recorded; `probe-2.log`, "## the envelope" (line 109) and "##
filter policy on attributes" (line 201): with raw delivery the queue holds the bare message, and a notification
whose attributes do not match the policy does not arrive while `Publish` answers 200. On `feat/536` at the commit
above no file under `studio/src/providers/aws/area/services/sns/` calls `GetSubscriptionAttributes` or
`SetSubscriptionAttributes`.

## Steps to Reproduce

1. Start a fresh emulator; create a topic and a queue whose policy lets the topic send; subscribe the queue.
2. `aws sns set-subscription-attributes --subscription-arn <arn> --attribute-name FilterPolicy --attribute-value '{"color":["red"]}'`.
3. Open the topic's page in Studio, "Subscriptions": the row reads as before, with nothing of the filter policy.
4. "Publish" a message with no attribute: "Published"; the queue stays empty and no screen says why.

## Expected

- A subscription's filter policy, its scope and its raw message delivery are shown as the emulator reports them.
- Each can be set and cleared from Studio, and the emulator reports the new value; a refusal is shown with the
  emulator's code and message.
- What the screens are is the task's requirement to decide, from the task and the emulator's API.

## Out of scope

A subscription's dead-letter queue (its own issue). Evaluating whether a given message matches a filter policy.
