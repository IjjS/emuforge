Issue-Id: 360
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|role-last-accessed-and-revoke-sessions
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build an IAM role's "Last Accessed" and "Revoke sessions" tabs

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A role's tabs "Last Accessed" and "Revoke sessions" (issue 82) lead to `/aws/iam/roles/details/<name>/last-accessed` and `/revoke-sessions`, which show the area's "no screen yet" page. What the emulator reports as last accessed, and what revoking sessions does in it, was not found out while planning issue 82; this issue's requirement finds it out first.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam generate-service-last-accessed-details --arn <role>   -> 200
$ aws iam get-role --role-name r   -> RoleLastUsed is empty, also after sts assume-role on the role and a call made with the role's credentials
Not called: get-service-last-accessed-details with the job id; anything for "Revoke active sessions" (the console puts an inline policy on the role).
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a role with the AWS CLI.
2. Open `/aws/iam/roles` and the role's page.
3. Choose the tab "Last Accessed", then "Revoke sessions".
4. Each page says there is no screen yet.

## Expected
- The requirement states by calling what the emulator reports for a role's last access and whether a policy that revokes sessions has any effect in it; each tab shows that, and a part the emulator does not have is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
IAM evaluation by the engine. Any engine change. Anything sent to real AWS.
