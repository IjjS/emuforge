Issue-Id: 547
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.topic|change-a-topic
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Change an SNS topic: display name, access policy, tags

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 9 of SNS's task list (issue 536, `requirement.md`): a developer changes a topic: its display name, its
access policy, its tags. Studio's SNS screens as issue 536 built them (`studio/src/providers/aws/area/services/sns/`): the topics list `/aws/sns/topics`, a topic's page with "Subscriptions" and "Publish", "Create topic", "Create subscription" show a topic's ARN, type, display name and subscription counts and change
nothing of a topic; its `Policy` and tags are not shown. The reference is `aws sns set-topic-attributes`, `aws sns
tag-resource`, `aws sns untag-resource` and `aws sns list-tags-for-resource` sent straight to aws-emulator. This
takes the place of the editing part of issue 380 (its delivery status logging is no task of the list).

## Evidence

The probes of issue 536 (aws-emulator 1.0.515, `.pm/issue-536/probe/` in the main checkout, described in `.pm/issue-536/requirement.md`, "What the emulator supports"; kept with the issue's working files, summary `.pm/archive/536.md`): `probe-2.log`, "## topic attributes" (line 710): `set-topic-attributes` changes the display name and
`get-topic-attributes` returns it with `Policy`. The tag operations were not called by the probes: the
requirement of this issue starts by calling them. On `feat/536` at the commit above no file under
`studio/src/providers/aws/area/services/sns/` calls `SetTopicAttributes` or a tag operation.

## Steps to Reproduce

1. Start a fresh emulator; create a topic.
2. Open its page in Studio: "Topic details" has no way to change the display name, and shows no policy and no tag.

## Expected

- A topic's display name can be changed from Studio and the emulator reports the new one.
- A topic's access policy is shown as the emulator reports it and can be changed; a refusal is shown as it came.
- A topic's tags are shown, added and removed, as far as the emulator's API answers (an operation that answers
  501 is shown as not implemented).

## Out of scope

Delivery status logging and the data protection policy (no task of the list). A subscription's attributes.
