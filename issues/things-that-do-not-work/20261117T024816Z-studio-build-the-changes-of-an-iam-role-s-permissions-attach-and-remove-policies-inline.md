Issue-Id: 357
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|role-permissions
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the changes of an IAM role's permissions: attach and remove policies, inline policies, the permissions boundary

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A role's page (issue 82) shows the role's policies and its permissions boundary and cannot change them: the console's "Add permissions" ("Attach policies", "Create inline policy"), "Remove", an inline policy's document and "Change boundary" are not there. The section "Set permissions boundary" of "Create role" is an item of the reference spec `studio/references/console/iam/create-role.yaml` that issue 82 leaves unbuilt (its one unmatched item), and Studio makes no instance profile for a role trusted by Amazon EC2, as the console does. The emulator holds all of it.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam attach-role-policy --role-name r --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess   -> 200; any ARN arn:aws:iam::aws:policy/<name> is accepted, held or not; a customer managed ARN it does not hold: 404 NoSuchEntity; the eleventh: 409 LimitExceeded
$ aws iam detach-role-policy   -> 200; a policy that is not attached: 404 NoSuchEntity
$ aws iam put-role-policy / get-role-policy / list-role-policies / delete-role-policy   -> 200
$ aws iam put-role-permissions-boundary --role-name r --permissions-boundary <arn>   -> 200, read back by GetRole
$ aws iam create-role ... --permissions-boundary <an ARN of a policy that does not exist>   -> 200, stored
$ aws iam create-instance-profile / add-role-to-instance-profile / list-instance-profiles-for-role   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a role with the AWS CLI.
2. Open `/aws/iam/roles` and the role's page.
3. The page has no "Add permissions", no "Remove" and no "Change boundary".

## Expected
- A role's managed policies can be attached and removed, an inline policy created, read, edited and deleted, and the boundary set, changed and removed; the emulator's answer, a refusal included, is shown.
- "Create role" has the section "Set permissions boundary" and sends the boundary; the spec's item matches (26/26).
- Whether Studio makes an instance profile for an Amazon EC2 role is decided in the requirement.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The Policies screens (their own issue). The trust policy. Any engine change. Anything sent to real AWS.
