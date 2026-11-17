Issue-Id: 361
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|create-role-web-identity-and-saml
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Add the trusted entity types "Web identity" and "SAML 2.0 federation" to "Create role"

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Create role" (issue 82) offers the trusted entity types "AWS service", "AWS account" and "Custom trust policy". The console's "Web identity" and "SAML 2.0 federation" choose an identity provider of the account; Studio has no screen for identity providers yet, so the two types were left out. The emulator holds identity providers and stores a trust policy with a federated principal.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam list-open-id-connect-providers   -> 200, empty on a fresh emulator
$ aws iam list-saml-providers   -> 200, empty
$ aws iam create-role ... (any trust policy that is JSON with a statement list)   -> 200, stored
Not called: create-open-id-connect-provider, create-saml-provider.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/roles/create`.
3. "Trusted entity type" offers three types; "Web identity" and "SAML 2.0 federation" are not among them.

## Expected
- Both types exist, list the emulator's identity providers to choose from, and build the trust policy the user guide describes; the role is created with it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The identity provider screens themselves (their own issue, which lands first). Any engine change. Anything sent to real AWS.
