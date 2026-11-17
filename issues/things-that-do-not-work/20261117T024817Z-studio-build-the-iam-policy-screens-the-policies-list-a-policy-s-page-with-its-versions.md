Issue-Id: 362
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|policies
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM policy screens: the Policies list, a policy's page with its versions, create, edit, delete

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/iam/policies` shows the area's "no screen yet" page. The emulator holds 135 AWS managed policies from its start and stores customer managed policies.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam list-policies --scope AWS   -> 200, 135 policies on a fresh emulator and after every restart
$ aws iam list-policies --scope Local / --only-attached / --path-prefix / --policy-usage-filter, --max-items with a marker   -> 200; customer managed policies come first; no parameter filters by name
$ aws iam create-policy --policy-name p --policy-document '<a policy>'   -> 200
$ aws iam get-policy / get-policy-version / list-policy-versions / create-policy-version / delete-policy-version / delete-policy / list-entities-for-policy   -> answered (200 or a 4xx of its own), none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/policies`.
3. The page says there is no screen yet.


## Expected
- The emulator's policies are listed with paging by its marker and told apart as AWS managed and customer managed; a policy's page shows its document, versions and the entities it is attached to; a customer managed policy can be created, edited (a new version) and deleted.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The console's visual policy editor. Attaching from a role's page (its own issue). Any engine change. Anything sent to real AWS.
