Issue-Id: 368
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam.role-list|roles-anywhere
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the role list's "Roles Anywhere" panel and what its "Manage" leads to

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's Roles page has a panel "Roles Anywhere" with the button "Manage" below the table. It is an item of the reference spec `studio/references/console/iam/role-list.yaml` that issue 82 leaves unbuilt (its one unmatched item). The emulator answers IAM Roles Anywhere.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws rolesanywhere list-trust-anchors   -> 200, empty on a fresh emulator
$ aws rolesanywhere list-profiles   -> 200, empty
Not called: create-trust-anchor, create-profile.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/roles`.
3. There is no "Roles Anywhere" below the table.

## Expected
- The requirement finds out by calling whether the emulator creates and keeps trust anchors and profiles. If it does, the panel exists (the spec's item matches) and "Manage" leads to screens that list, create and delete them; if it does not, the item is marked `omitted` by the `pm` with those calls as the reason.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The panel's descriptive texts, which are the console's. Any engine change. Anything sent to real AWS.
