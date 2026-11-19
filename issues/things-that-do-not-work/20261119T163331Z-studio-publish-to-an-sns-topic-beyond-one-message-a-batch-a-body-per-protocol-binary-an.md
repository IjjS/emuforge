Issue-Id: 549
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.publish|beyond-one-message
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Publish to an SNS topic beyond one message: a batch, a body per protocol, binary and array attributes

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 11 of SNS's task list (issue 536, `requirement.md`): a developer publishes beyond one message: a batch, a
body per protocol (`MessageStructure`), `Binary` and array attributes. Studio's SNS screens as issue 536 built them (`studio/src/providers/aws/area/services/sns/`): the topics list `/aws/sns/topics`, a topic's page with "Subscriptions" and "Publish", "Create topic", "Create subscription": "Publish" sends one message with a
subject and attributes of type "String" and "Number". The reference is `aws sns publish` with `--message-structure
json` or a `Binary` or `String.Array` attribute, and `aws sns publish-batch`, sent straight to aws-emulator. This
takes the place of what is left of issue 381.

## Evidence

The probes of issue 536 (aws-emulator 1.0.515, `.pm/issue-536/probe/` in the main checkout, described in `.pm/issue-536/requirement.md`, "What the emulator supports"; kept with the issue's working files, summary `.pm/archive/536.md`): `probe-1.log`, "## publish and what arrives in the queue" (line 409) and "## publish: what is
refused" (line 428; `--message-structure` at line 519) and `probe-2.log`, "## the envelope" (line 109): what the emulator accepts,
refuses and delivers for each. `PublishBatch` was not called by the probes: the requirement of this issue starts
by calling it. In `studio/src/providers/aws/area/services/sns/components/publish-tab.tsx` at the commit above the
attribute types are "String" and "Number" only.

## Steps to Reproduce

1. Start a fresh emulator; create a topic.
2. Open its page in Studio, "Publish", "Add attribute": "Type" offers "String" and "Number"; the form has no
   message structure and sends one message.

## Expected

- A message can be published with a body per protocol, and with `Binary` and array attributes, and what arrives
  in a subscribed queue is what a direct call delivers.
- Several messages can be published in one request, and each one's outcome is shown as the emulator returned it.

## Out of scope

Following a message into a function's log (Lambda's task). A size limit kept by Studio.
