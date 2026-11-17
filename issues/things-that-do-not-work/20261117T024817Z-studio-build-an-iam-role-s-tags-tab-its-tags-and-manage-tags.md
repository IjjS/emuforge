Issue-Id: 359
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|role-tags
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build an IAM role's "Tags" tab: its tags and "Manage tags"

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A role's tab "Tags" (issue 82) leads to `/aws/iam/roles/details/<name>/tags`, which shows the area's "no screen yet" page. "Create role" (issue 82) can give a role tags, and the emulator keeps them, but Studio cannot show or change them afterwards.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam create-role ... --tags Key=a,Value=1   -> 200, GetRole returns Tags (a key given twice is stored twice)
$ aws iam list-role-tags --role-name r   -> 200
$ aws iam tag-role / untag-role   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a role with the AWS CLI.
2. Open `/aws/iam/roles` and the role's page.
3. Choose the tab "Tags".
4. The page says there is no screen yet.

## Expected
- The tab lists the role's tags; they can be added, changed and removed, and the emulator's answer is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Tags of other IAM resources. Any engine change. Anything sent to real AWS.
