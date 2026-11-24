Issue-Id: 647
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.opscenter|service-screens
Issue-Check-Ids:
Issue-Commit: fcbc3b6e103a2f83fdfb4879a333e95dca6d9da2

# Build Systems Manager OpsCenter and operations summary screens

> Identified against commit `fcbc3b6e103a2f83fdfb4879a333e95dca6d9da2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 7 of 7 from #80. Developers need to inspect and work with OpsItems, OpsMetadata and operations summaries in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, DescribeOpsItems, ListOpsMetadata and GetOpsSummary each returned HTTP 200 and an empty result collection. The console flow reference is `docs/aws-console/systems-manager/28-opscenter.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm describe-ops-items --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Display the actual OpsItem and metadata collections and summary results. Show supported changes to local items and verify them with direct reads. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
