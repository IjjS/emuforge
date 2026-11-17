Issue-Id: 378
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sqs|parts-waiting-for-captures
Issue-Check-Ids:
Issue-Commit: 6ecc85128a673b379660e2119ab6b783412cd250

# Add the SQS queue screens' parts that wait for captures: "Actions" entries, a queue page's tabs and labels

> Identified against commit `6ecc85128a673b379660e2119ab6b783412cd250`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Studio's SQS screens (issue 79) were written from one capture, `docs/aws-console/sqs/02-queues`, which shows the list empty with the menu "Actions" closed; no capture shows a queue's page or "Create queue". So "Actions" holds only the two entries the user guide names, a queue's page has no tabs and an order of actions and sections no source shows, and some labels are provisional: "Encryption key type", the section title "Details" of "Create queue", and the labels of a queue's page taken from the API's model ("ARN", "URL", "Last modified", "Messages delayed", "Dead-letter queue ARN", "Redrive permission", "Source queues"). The list's row values of "Encryption" are the user guide's option labels, not a capture's.

Reference: the AWS console's SQS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sqs/` in the main checkout, outside git, and the Amazon SQS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the queue screens of issue 79 are: `console` screens of the area, a reference spec each under `studio/references/console/sqs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 79 (the full output was kept in that plan's probe logs):

```
The capture's outline of the Queues page: button "Actions" (closed, disabled); no row.
User guide, Amazon SQS Developer Guide: "From **Actions**, choose **Purge**"; the pages name the options "Amazon SQS key (SSE-SQS)" and "AWS Key Management Service key (SSE-KMS)" and no label for the choice.
$ aws sqs get-queue-attributes --queue-url <url> --attribute-names All   -> 200, every value these labels show
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a queue with the AWS CLI.
2. Open `/aws/sqs/queues` and select the queue.
3. Open "Actions": two entries. Open the queue's page: no tabs.

## Expected
- Once the owner has added captures of the Queues page with rows and "Actions" open, of a queue's page and of "Create queue", the three reference specs and the screens take the captures' entries, tabs, sections, order and labels.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Building the screens behind new entries or tabs (their own issues). Any engine change. Anything sent to real AWS.
