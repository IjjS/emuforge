Issue-Id: 646
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.patch-windows|service-screens
Issue-Check-Ids:
Issue-Commit: 100b59a8aba7dd56ac77ae5bcc03020c12c6d78f

# Build Systems Manager patch and maintenance window screens

> Identified against commit `100b59a8aba7dd56ac77ae5bcc03020c12c6d78f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 6 of 7 from #80. Developers need to inspect and work with patch baselines, patch catalog entries and maintenance windows in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, DescribePatchBaselines returned AWS-managed baselines, DescribeAvailablePatches returned a catalog, and DescribeMaintenanceWindows returned an empty list. DescribePatchGroups returned 501 NotImplemented. The console flow reference is `docs/aws-console/systems-manager/13-patch-manager.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm describe-patch-baselines --max-results 10 --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Display the baseline and patch identifiers returned by the emulator and its maintenance window list. Changes to writable resources agree with direct reads. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
