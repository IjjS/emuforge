Issue-Id: 649
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|sqs-client-origin|null-on-main
Issue-Check-Ids: studio.aws-sqs-client-keeps-a-queue-url-on-the-engine
Issue-Commit: 4ce108cc59d1199fc12fc7ddbab86596767357c3

# SQS client origin check observes an additional null origin on main

> Identified against commit `4ce108cc59d1199fc12fc7ddbab86596767357c3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The common SQS client check failed on the #83 merge push. CI selected KMS plus the common checks. All ten standard KMS scenarios passed.

## Evidence

[Push run 45512899275](https://github.com/IjjS/emuforge/actions/runs/45512899275) failed in integration. In the saved log at `.pm/run/ci-4ce108cc5.log`, lines 888–898 show an additional origin string "null" beside the expected loopback origin. The source of the extra observation is undetermined.

## Steps to Reproduce

Inspect the failed Ubuntu run and its request observations for the named criterion. Local reproduction has not been established.

## Expected

The observed request origins, including preflights, match the expected engine origin.

## Out of scope

Unrelated KMS feature work.
