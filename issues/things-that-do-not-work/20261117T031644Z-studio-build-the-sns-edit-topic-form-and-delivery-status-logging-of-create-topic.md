Issue-Id: 380
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|edit-topic
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS "Edit topic" form, and "Delivery status logging" of "Create topic"

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Edit" on the topic list and on a topic's page (issue 78) leads to `/aws/sns/topic/<arn>/edit`, which shows the area's "no screen yet" page, so a topic's display name, encryption, access policy, delivery retry policy, delivery status logging, tags and active tracing cannot be changed in Studio, and of those a topic's page shows the display name only. The section "Delivery status logging" of "Create topic" is an item of the reference spec `studio/references/console/sns/create-topic.yaml` that issue 78 leaves unbuilt (its one unmatched item). The emulator stores all of it.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns set-topic-attributes --attribute-name DisplayName | Policy | DeliveryPolicy | KmsMasterKeyId | TracingConfig | SignatureVersion   -> 200, read back by get-topic-attributes
$ aws sns create-topic --attributes <the delivery status logging attributes: feedback role ARNs and a success sample rate>   -> 200, read back
$ aws sns set-topic-attributes --attribute-name Policy --attribute-value 'not json'   -> 400 InvalidParameter
$ aws sns tag-resource / untag-resource / list-tags-for-resource   -> 200; a 51st tag: 400 TagLimitExceeded
$ aws sns add-permission / remove-permission   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a topic with the AWS CLI.
2. Open `/aws/sns/topics` and the topic's page.
3. Select the topic and choose "Edit".
4. The page says there is no screen yet.

## Expected
- "Edit" opens a form with the topic's current values; saving sends only what changed and the emulator's answer, a refusal included, is shown.
- "Create topic" and the edit form have the section "Delivery status logging" and send its attributes; the spec's item matches (34/34).
- A topic's page shows what the form sets, as far as the user guide or a capture names where.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The data protection policy and a FIFO topic's archive policy (the issue for the parts that wait for captures). Subscriptions. Any engine change. Anything sent to real AWS.
