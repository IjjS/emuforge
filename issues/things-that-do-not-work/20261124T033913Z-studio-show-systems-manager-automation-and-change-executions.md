Issue-Id: 645
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.automation|service-screens
Issue-Check-Ids:
Issue-Commit: 40c163a7eba69bf728d9c5b3c248bcb391558544

# Show Systems Manager automation and change executions

> Identified against commit `40c163a7eba69bf728d9c5b3c248bcb391558544`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 5 of 7 from #80. Developers need to inspect and work with automation executions and related change execution workflows in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, DescribeAutomationExecutions returned HTTP 200 with an empty AutomationExecutionMetadataList. The console flow reference is `docs/aws-console/systems-manager/17-automation.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm describe-automation-executions --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

The execution list agrees with the direct result. For a supported execution workflow, show the execution and its observed state after the action. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
