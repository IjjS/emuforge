Issue-Id: 641
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ssm.parameter-settings|service-screens
Issue-Check-Ids:
Issue-Commit: 2cff9665d5107361a32422403902c4e0b9575710

# Show shared Systems Manager parameters and account settings

> Identified against commit `2cff9665d5107361a32422403902c4e0b9575710`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Systems Manager follow-up 1 of 7 from #80. Developers need to inspect and work with shared parameters and the account-wide default parameter tier in Studio. The source of truth is the local emulator. Confirm each action with a valid resource before including it.

## Evidence

On aws-emulator 1.0.588 in us-east-1, using an isolated loopback endpoint, DescribeParameters with Shared=true returned an empty Parameters array. GetServiceSetting returned Standard for /ssm/parameter-store/default-parameter-tier. UpdateServiceSetting and ResetServiceSetting succeeded. The console flow reference is `docs/aws-console/systems-manager/25-parameter-store.mhtml`. At the identified commit the service directory contains only its registration.

## Steps to Reproduce

1. Start an isolated local emulator and configure the CLI for its loopback endpoint, emulator credentials and CA.
2. Run `aws ssm get-service-setting --setting-id /ssm/parameter-store/default-parameter-tier` against that endpoint and record the response.
3. Open Systems Manager in Studio and look for the corresponding resources and actions.

## Expected

Display the shared-list result and current setting. After a supported change or reset the displayed setting agrees with a direct read. On a supported resource, include its detail and applicable lifecycle or service-specific actions as demonstrated by the emulator.

## Out of scope

The parameter lifecycle in #80, the other Systems Manager follow-up groups and other AWS services.
