Issue-Id: 381
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|publish-message
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS "Publish message" screen

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Publish message" on the topic list and on a topic's page (issue 78) leads to `/aws/sns/topic/<arn>/publish`, which shows the area's "no screen yet" page. The emulator answers `Publish` and `PublishBatch` to a topic with a message id. In the probe a queue subscribed to the topic held no message afterwards; this issue's requirement finds out by calling what the emulator does with a published message, and the screen says only that.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns publish --topic-arn <topic> --message hello   -> 200, a MessageId
$ aws sns publish-batch --topic-arn <topic> ...   -> 200
$ aws sqs receive-message on a queue subscribed to the topic (protocol sqs) after the publish   -> 0 messages
$ aws sns publish --phone-number +1...   -> 501 NotImplemented, "operation Publish to a PhoneNumber is scaffolded but not implemented in this emulator"
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a topic with the AWS CLI.
2. Open `/aws/sns/topics` and the topic's page.
3. Select the topic and choose "Publish message".
4. The page says there is no screen yet.

## Expected
- The form has the user guide's parts ("Message details", "Message body", "Message attributes"; for a FIFO topic the message group and deduplication ids), sends one `Publish` and shows the emulator's answer: the message id, or the refusal.
- EmuForge's words about delivery say only what a check shows the emulator does.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Publishing to a phone number (the SMS issue) or to a platform endpoint (the mobile push issue). Any engine change. Anything sent to real AWS.
