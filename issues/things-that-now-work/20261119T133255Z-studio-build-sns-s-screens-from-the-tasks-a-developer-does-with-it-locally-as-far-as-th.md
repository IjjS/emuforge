Issue-Id: 536
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|sns|tasks-by-the-emulator-api
Issue-Check-Ids: studio.sns-topics-made-elsewhere-are-shown studio.sns-create-topic-reaches-the-emulator studio.sns-subscribe-a-queue-and-a-published-message-arrives studio.sns-delivery-says-what-the-policy-allows studio.sns-subscribe-a-function-and-it-runs studio.sns-publish-to-a-fifo-topic-and-refusals studio.sns-delete-a-subscription-and-a-topic studio.sns-screens-follow-an-emulator-restart
Issue-Commit: a133f4428c647a63622bd88a819adbb2ec7b92c5

# Build SNS's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `a133f4428c647a63622bd88a819adbb2ec7b92c5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

SNS by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as issues 480, 481, 496 and 516 did:
find what the emulator supports of SNS, break what a developer does with it locally into tasks, order them by
importance and build from the top. Likely at the core: see the topics and what each is (standard or FIFO, its
subscriptions); create a topic; subscribe an SQS queue or a Lambda function to it and see the subscription confirmed;
publish a message with attributes and see it arrive (in the subscribed queue, through SQS's screens); delete a
subscription and a topic; then filter policies, raw message delivery, a dead-letter queue of a subscription, topic
policies. Issue 78 planned SNS the old way (a topics list); this issue replaces it and closes it. The area's shared
parts on `main` are used where they fit, and SQS's and Lambda's screens are linked where a task crosses into them.

## Evidence

The owner's decisions of 2026-11-18 (`.pm/archive/478/`) and the order of services (`.pm/product/services.md`); the probe of the emulator (`.pm/run/probe-services-*.json`: which reads answer).

## Steps to Reproduce

Open `/aws/sns`: "No screen yet".

## Expected

A developer can do SNS's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope
