Issue-Id: 630
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|sqs.queue-url|ci-host-mismatch
Issue-Check-Ids: engine.relay-sqs-queue-url-follow-up-reaches-engine studio.aws-sqs-client-keeps-a-queue-url-on-the-engine
Issue-Commit: 0c8fc6884e4c44b752f03ecd05e24e52ffb56d7e

# Resolve the SQS queue URL host mismatch in the Ubuntu push checks

> Identified against commit `0c8fc6884e4c44b752f03ecd05e24e52ffb56d7e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

CreateQueue returned a loopback QueueUrl. The engine body comparison expected the AWS-shaped hostname, and the Studio fixture expected the direct emulator response to match an amazonaws.com host.

## Evidence

Ubuntu push run https://github.com/IjjS/emuforge/actions/runs/44974046336 selected every service because the shared Studio client factory changed. Emulator 1.0.565. Failed output: .pm/run/ci-0c8fc6884.log. The local branch check passed against 1.0.556.

## Steps to Reproduce

1. Use the loopback emulator version and integration IDs identified above.
2. Compare the direct emulator response with the failing assertion in the saved CI log.

## Expected

The relay preserves the emulator's response and follow-up queue operations reach only the local engine and emulator. The checks verify those properties with the URL form the emulator returns.

## Out of scope

Lambda versions and aliases.
