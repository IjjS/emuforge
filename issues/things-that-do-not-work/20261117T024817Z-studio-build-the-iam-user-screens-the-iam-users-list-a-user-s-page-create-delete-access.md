Issue-Id: 363
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|users
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM user screens: the IAM users list, a user's page, create, delete, access keys

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/iam/users` shows the area's "no screen yet" page. The emulator holds users and their access keys; its own caller is the user `emulator`.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam list-users   -> 200
$ aws iam get-user (no name)   -> 200, the user `emulator`, arn:aws:iam::000000000000:user/emulator
$ aws iam create-user / delete-user / create-access-key / list-access-keys / attach-user-policy / list-attached-user-policies / list-groups-for-user   -> answered (200 or a 4xx of its own), none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/users`.
3. The page says there is no screen yet.


## Expected
- The emulator's users are listed, opened, created and deleted; a user's policies, groups and access keys are shown; an access key can be created and deleted.
- A secret access key is shown only when the user asks for it, once, and is never stored, logged or put in a URL.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Console passwords and MFA devices unless the requirement finds the emulator holds them. Any engine change. Anything sent to real AWS.
