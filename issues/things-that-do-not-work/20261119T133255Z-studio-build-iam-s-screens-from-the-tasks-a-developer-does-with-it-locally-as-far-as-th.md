Issue-Id: 535
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|iam|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: a133f4428c647a63622bd88a819adbb2ec7b92c5

# Build IAM's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `a133f4428c647a63622bd88a819adbb2ec7b92c5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

IAM by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as issues 480 (S3), 481 (SQS), 496
(DynamoDB) and 516 (Lambda) did: find what the emulator supports of IAM, break what a developer does with it locally
into tasks, order them by importance and build from the top. Likely at the core: see the roles and what each may do
(its trust policy, its attached and inline policies); create a role for a service to assume and attach a policy to
it (what every Lambda function, event source mapping and Step Functions state machine needs first); read and edit a
policy document; delete a role; then users and their access keys, groups, customer managed policies and their
versions, instance profiles.

IAM's screens on `main` come from issue 82 and its followers, built the old way (lists and pages after the console):
the plan keeps what serves a task and rebuilds or removes what does not, and says which. Lambda's create form already
creates a role (issue 516); what it shares with IAM is used, not written twice. The open IAM issues filed the old way
are named in the report as held by a later task or closed out. This issue is Studio's screens over the emulator's IAM
API; evaluating a policy (roadmap step 3, `PRODUCT.md`) is not part of it.

## Evidence

The owner's decisions of 2026-11-18 (`.pm/archive/478/`) and the order of services (`.pm/product/services.md`); the probe of the emulator (`.pm/run/probe-services-*.json`: which reads answer).

## Steps to Reproduce

Open `/aws/iam`: roles can be seen; the tasks above cannot be done from start to end.

## Expected

A developer can do IAM's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope
