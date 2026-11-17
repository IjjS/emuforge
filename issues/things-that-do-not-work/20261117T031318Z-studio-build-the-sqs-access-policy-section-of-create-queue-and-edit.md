Issue-Id: 374
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|access-policy
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Build the SQS "Access policy" section of "Create queue" and "Edit"

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The section "Access policy" is an item of the reference spec `studio/references/console/sqs/create-queue.yaml` that issue 79 leaves unbuilt (one of its three unmatched items); a queue's page shows a policy as text and nothing can change it. The emulator stores a queue's policy.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
$ aws sqs create-queue --queue-name q --attributes Policy='<a policy>'   -> 200, read back by get-queue-attributes
$ aws sqs create-queue ... Policy='not json'   -> 400
$ aws sqs set-queue-attributes ... Policy=''   -> 200, the policy is gone
$ aws sqs add-permission --queue-url <url> --label l --aws-account-ids 000000000000 --actions SendMessage   -> 200, Policy holds the statement
$ aws sqs remove-permission --queue-url <url> --label l   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/sqs/queues/create`.
3. There is no section "Access policy".

## Expected
- "Create queue" and "Edit" have the section with "Basic" and "Advanced" and send the policy; the spec's item matches; the emulator's refusal of a policy is shown as it came.
- The screen says that the emulator stores the policy; whether anything evaluates it is for the requirement to find out.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
IAM evaluation by the engine. Any engine change. Anything sent to real AWS.
