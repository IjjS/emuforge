Issue-Id: 375
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|subscribe-to-sns-topic
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build the SQS "Subscribe to Amazon SNS topic" action

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Actions" > "Subscribe to Amazon SNS topic" on the queue list (issue 79) leads to `/aws/sqs/queues/queue/<name>/subscribe-to-sns-topic`, which shows the area's "no screen yet" page. The emulator subscribes a queue to a topic and delivers.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws sns create-topic --name t   -> 200
$ aws sns subscribe --topic-arn <topic> --protocol sqs --notification-endpoint <queue arn>   -> 200, SubscriptionArn
$ aws sns publish --topic-arn <topic> --message m   -> 200; ApproximateNumberOfMessages of the queue is 1
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a queue with the AWS CLI.
2. Open `/aws/sqs/queues` and select the queue.
3. Choose "Actions" > "Subscribe to Amazon SNS topic".
4. The page says there is no screen yet.

## Expected
- The emulator's topics are offered, the queue is subscribed to the one chosen, and the emulator's answer is shown; the requirement finds out whether the queue's access policy must allow the topic on the emulator.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
SNS's own screens. Listing a queue's subscriptions. Any engine change. Anything sent to real AWS.
