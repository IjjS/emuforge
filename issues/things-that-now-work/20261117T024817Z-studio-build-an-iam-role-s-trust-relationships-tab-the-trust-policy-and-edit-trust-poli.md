Issue-Id: 358
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|role-trust-relationships
Issue-Check-Ids: studio.iam-role-page-shows-each-policy-document-and-the-trust-policy studio.iam-role-trust-policy-edit-reaches-the-emulator
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build an IAM role's "Trust relationships" tab: the trust policy and "Edit trust policy"

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A role's tab "Trust relationships" (issue 82) leads to `/aws/iam/roles/details/<name>/trust-relationships`, which shows the area's "no screen yet" page. The role list shows only the principals of the trust policy. The emulator stores the document and replaces it.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam get-role --role-name r   -> 200, AssumeRolePolicyDocument (percent-encoded in the raw answer; stored as content, read back in its shortest form)
$ aws iam update-assume-role-policy --role-name r --policy-document '<a policy>'   -> 200
$ aws iam create-role ... --assume-role-policy-document 'not json'   -> 400 MalformedPolicyDocument "This policy contains invalid Json"; '{}' -> "Policy has no statements"
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a role with the AWS CLI.
2. Open `/aws/iam/roles` and the role's page.
3. Choose the tab "Trust relationships".
4. The page says there is no screen yet.

## Expected
- The tab shows the role's trust policy as formatted text and its trusted entities; "Edit trust policy" replaces it, and the emulator's answer, a refusal included, is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The console's policy validation and Access Analyzer findings. Any engine change. Anything sent to real AWS.
