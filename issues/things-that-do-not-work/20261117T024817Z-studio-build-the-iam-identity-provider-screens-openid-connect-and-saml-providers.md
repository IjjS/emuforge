Issue-Id: 365
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|identity-providers
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM identity provider screens: OpenID Connect and SAML providers

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/iam/identity-providers` shows the area's "no screen yet" page. The emulator answers the lists of both kinds of provider.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam list-open-id-connect-providers   -> 200, empty on a fresh emulator
$ aws iam list-saml-providers   -> 200, empty
$ aws iam create-open-id-connect-provider / get-open-id-connect-provider / delete-open-id-connect-provider / create-saml-provider / get-saml-provider / delete-saml-provider (no parameter)   -> a 400 of its own each, none 501
Not called: a create with valid parameters.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/identity-providers`.
3. The page says there is no screen yet.


## Expected
- The requirement finds out by calling that the emulator creates and keeps each kind; those are listed, opened, created and deleted in Studio.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
IAM Identity Center (issue 269). The role types that use a provider (their own issue). Any engine change. Anything sent to real AWS.
