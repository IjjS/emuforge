Issue-Id: 369
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam.roles|parts-that-wait-for-captures
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Settle the IAM role screens' parts that wait for captures: the tab order, header actions, "Summary", the wizard's titles, the dialogs

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
No capture shows a role's page, the "Create role" wizard or their dialogs, so issue 82 took these from the user guide, the API's model or EmuForge's own words, each marked provisional in its sources file: the order of the role page's tabs; that the page has no header action (so a role cannot be deleted from its own page); which fields "Summary" holds and their order; the section title "Permissions policies" on a role's page; the wizard's three step titles, its "Role details" and "Add tags"; the dialog of "Edit" of "Summary" (titled "Edit summary" by Studio); the dialog the badge "Service-Linked Role" opens; the delete dialog's title for one role ("Delete 1 role?"). The owner's capture `docs/aws-console/iam/02-roles` shows the list and the delete dialog with no role selected.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
The outline of the capture 02-roles: h1 "Roles (n)", buttons "Refresh roles", "Delete", "Create role", a badge button "Service-Linked Role" in a row, the dialog "Delete 0 roles?".
No file under docs/aws-console/iam/ shows a role's page or the wizard (00-landing to 14-resource-control-policies).
$ aws iam get-role --role-name r   -> 200 with Path, RoleName, RoleId, Arn, CreateDate, AssumeRolePolicyDocument, Description, MaxSessionDuration, RoleLastUsed, Tags (the fields a "Summary" can show)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a role with the AWS CLI.
2. Open `/aws/iam/roles` and the role's page.
3. The tabs are in the order "Permissions", "Trust relationships", "Tags", "Last Accessed", "Revoke sessions"; the page's header has only Studio's "Refresh role".

## Expected
- Once the owner has added captures of a role's page, each step of "Create role", the dialog of "Edit" and the delete dialog with one role selected, the `pm` changes the three specs to what the captures show and the screens follow: labels, order, header actions (delete from the role's page among them), and the dialogs' titles.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Parts the captures show that are other issues' (the other tabs' content, policies). Any engine change. Anything sent to real AWS.
