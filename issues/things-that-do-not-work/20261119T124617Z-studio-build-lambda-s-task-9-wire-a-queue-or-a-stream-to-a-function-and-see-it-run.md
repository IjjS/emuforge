Issue-Id: 526
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.event-source-mappings|task
Issue-Check-Ids:
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 9: wire a queue or a stream to a function and see it run

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 9: a developer wires an SQS queue, a DynamoDB stream or a Kinesis stream to a function and sees the function run
with what arrives. Studio has no screen for event source mappings. The reference is the same request sent straight to
aws-emulator: `CreateEventSourceMapping`, `ListEventSourceMappings`, `UpdateEventSourceMapping`,
`DeleteEventSourceMapping`. This task takes the place of issues 349 (event source mappings and a function's triggers)
and 376 (an SQS queue's Lambda triggers), which the pm cuts again with it.

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## event source mapping: SQS" and "## event source mapping: DynamoDB stream and Kinesis": while the
  function's role may not read the source, `CreateEventSourceMapping` is refused, 400
  `InvalidParameterValueException`.
- `probe-3.log`, "## SQS" and "## DynamoDB stream and Kinesis": with a role that may read the source the mapping is
  `Enabled` within 0.5 s; a message sent to the queue was consumed within 0.5 s and the mapping's
  `LastProcessingResult` was `OK`; `UpdateEventSourceMapping` disables it, `DeleteEventSourceMapping` removes it.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. No control adds a queue or a stream as the function's source, and no screen lists the mappings.

## Expected

- A developer adds a queue or a stream of the emulator as a function's source and sees the mapping and its state.
- The refusal for a role that may not read the source is reported so that the developer knows the role is the cause.
- A developer disables, enables and deletes a mapping.
- A message sent to the queue is seen to have been processed (the mapping's last result).
- Each proven by a scenario against the real emulator.

## Out of scope

Filter criteria, destinations on failure, sources other than SQS, DynamoDB streams and Kinesis; reading the function's log of those invocations (task 7).
