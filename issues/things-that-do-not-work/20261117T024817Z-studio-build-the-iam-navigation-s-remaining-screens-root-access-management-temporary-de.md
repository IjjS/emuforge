Issue-Id: 370
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|root-access-delegation-multi-account
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM navigation's remaining screens: "Root access management", "Temporary delegation requests", "Multi-account access"

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's IAM navigation has the entries "Root access management", "Temporary delegation requests" and a group "Multi-account access" (Account access manager, Organization activity, Service control policies, Resource control policies), which the owner's captures under `docs/aws-console/iam/` show; Studio has no screen for any of them. What the emulator holds for each was barely probed while planning issue 82; this issue's requirement finds it out first.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam list-delegation-requests   -> 200
$ aws iam enable-organizations-root-credentials-management / disable-... / enable-organizations-root-sessions / disable-...   -> 501 NotImplemented (the only four of 176 IAM operations)
$ aws iam list-organizations-features   -> a 4xx: there is no organization
$ aws organizations list-policies --filter SERVICE_CONTROL_POLICY   -> 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/root-access-management`.
3. The page says there is no screen yet.


## Expected
- The requirement states, per entry, what the emulator holds by calling it; an entry with resources of the emulator gets its screen, an action the emulator answers 501 for reports "Not implemented by the emulator", and an entry without anything is recorded as left out with the calls that show it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
AWS Organizations' own screens (its own service's issue). IAM Identity Center (issue 269). Any engine change. Anything sent to real AWS.
