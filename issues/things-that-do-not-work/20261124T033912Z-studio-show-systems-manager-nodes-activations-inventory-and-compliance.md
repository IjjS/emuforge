Issue-Id: 643
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.nodes-inventory|service-screens
Issue-Check-Ids:
Issue-Commit: 740e54a3f0b159d767a9023ac96a528cce7a0763

# Show Systems Manager nodes, activations, inventory and compliance

> Identified against commit `740e54a3f0b159d767a9023ac96a528cce7a0763`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 3 of 7 from #80. Developers need to inspect and work with managed nodes, hybrid activations, inventory, compliance items and resource data syncs in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, DescribeInstanceInformation, DescribeActivations, GetInventory, ListComplianceItems and ListResourceDataSync returned empty collections. GetInventorySchema returned AWS:AWSComponent. ListNodes refused the integrated experience for this account. Both compliance summary lists returned 501. The console flow reference is `docs/aws-console/systems-manager/12-inventory.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm get-inventory-schema --max-results 10 --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Show the returned schema and actual records or empty collections for supported lists. Keep the account refusal distinct from an empty collection. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
