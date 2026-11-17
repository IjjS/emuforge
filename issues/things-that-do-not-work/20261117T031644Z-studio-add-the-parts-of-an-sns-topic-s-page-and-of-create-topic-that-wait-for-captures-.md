Issue-Id: 382
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns.topic|parts-that-wait-for-captures
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Add the parts of an SNS topic's page and of "Create topic" that wait for captures: further tabs, "Integrations", FIFO details, the data protection policy

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
No capture shows a topic's page or the create form, so issue 78 built them from the user guide and marked several items provisional (its specs' sources files): the page's tabs and their order ("Subscriptions", "Integrations"; the console has further tabs no page of the guide names), the place of "Type" among the details, the header's three actions, the columns of the subscriptions table, the labels "Policy" and "Delivery policy", the place of "Maximum message size" and of "Active tracing" on the form. The tab "Integrations" leads to `/aws/sns/topic/<arn>/integrations`, which shows "no screen yet". A FIFO topic's content-based deduplication and archive policy, and a topic's data protection policy, are stored by the emulator and shown nowhere.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns get-topic-attributes of a FIFO topic   -> FifoTopic true, ContentBasedDeduplication; ArchivePolicy and FifoThroughputScope when set
$ aws sns create-topic --data-protection-policy '<a policy>'   -> 200; get-data-protection-policy returns it
$ aws sns put-data-protection-policy   -> 400 InvalidAction, "Operation (PutDataProtectionPolicy) is not supported in this region"
$ aws sns get-topic-attributes   -> TracingConfig when set (what "Integrations" shows as active tracing in the guide)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a topic with the AWS CLI.
2. Open `/aws/sns/topics` and the topic's page.
3. The page has the tabs "Subscriptions" and "Integrations" only; "Integrations" says there is no screen yet.

## Expected
- Once the owner has added captures of a topic's page (each tab) and of the create form (every section expanded, standard and FIFO), the `pm` changes the three specs to them, and the parts the captures show and the emulator holds exist with the captures' labels and order.
- A part the emulator cannot produce is `omitted` with the calls that show it (the data protection policy can be read and given at creation, not put).
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Editing a topic. Subscriptions. Any engine change. Anything sent to real AWS.
