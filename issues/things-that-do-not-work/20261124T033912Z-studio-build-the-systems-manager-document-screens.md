Issue-Id: 642
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.documents|service-screens
Issue-Check-Ids:
Issue-Commit: 912dd6b312b7f9ba22621daf3dc7f6dc2614104a

# Build the Systems Manager document screens

> Identified against commit `912dd6b312b7f9ba22621daf3dc7f6dc2614104a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 2 of 7 from #80. Developers need to inspect and work with SSM documents, including document-backed packages and change calendars in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, ListDocuments returned AWS-ASGEnterStandby with DocumentType Automation, version 1 and JSON format. The console flow reference is `docs/aws-console/systems-manager/20-documents.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm list-documents --max-results 10 --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Find a returned document and show its supported content and versions. Changes to a writable local document appear in direct reads. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
