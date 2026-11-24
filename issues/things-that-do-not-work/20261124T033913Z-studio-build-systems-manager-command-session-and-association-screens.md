Issue-Id: 644
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.commands-sessions|service-screens
Issue-Check-Ids:
Issue-Commit: 06d560bb6c420deb6539d817bc562c55debc65dd

# Build Systems Manager command, session and association screens

> Identified against commit `06d560bb6c420deb6539d817bc562c55debc65dd`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 4 of 7 from #80. Developers need to inspect and work with Run Command, Session Manager and State Manager associations in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, ListCommands, ListCommandInvocations, DescribeSessions with State=Active and ListAssociations each returned an empty collection. The console flow reference is `docs/aws-console/systems-manager/14-run-command.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm describe-sessions --state Active --no-paginate` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Display the actual command, session and association collections. Show detail and state changes for operations verified with matching local fixtures. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
