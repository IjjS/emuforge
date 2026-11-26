Issue-Id: 653
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|iam.role-checks|emulator-1.0.625
Issue-Check-Ids: studio.iam-role-list-empty-emulator-says-no-roles studio.iam-role-list-pages-follow-the-emulator studio.lambda-function-create-lists-the-roles-of-the-emulator
Issue-Commit: 0c61126728831e11f4a5a6832cb140ae88483b27

# IAM role list and Lambda role choice checks fail on emulator 1.0.625: the roles listed are not the ones expected

> Identified against commit `0c61126728831e11f4a5a6832cb140ae88483b27`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The machine's emulator image moved from 1.0.588 to 1.0.625 on 2026-11-26 and the full checks were run on `main` (`pm-check .`, commit `e46981c`). 426 integration checks passed; six failed, in two groups. On 1.0.588 these checks passed (the whole checks of issues 80 and 83). Whether the emulator's behaviour changed or the checks rely on something it never promised is for the requirement to find by calling the emulator directly. This file is the IAM group: the roles the emulator lists are not the ones the checks expect (an empty emulator is not shown as holding no role; a direct `ListRoles` does not list exactly the twelve roles made; Lambda's create form does not list exactly the emulator's roles as expected).

## Evidence

`.pm/run/main-check-1.0.625-integration.log`, lines 760-762 and 815:

```
failed  studio.iam-role-list-empty-emulator-says-no-roles  Error: 3 of 3 criteria lines failed:
failed  studio.iam-role-list-pages-follow-the-emulator  Error: a direct ListRoles lists the twelve roles
failed  studio.lambda-function-create-lists-the-roles-of-the-emulator  Error: 2 of 2 criteria lines failed:
```

The other IAM role checks of the same run passed.

## Steps to Reproduce

1. With the image `aws-emulator` at 1.0.625, run `pm-check . --checks` with the three check ids above.
2. Each fails as in the evidence.

## Expected

- The three checks pass on the machine's emulator image, each asserting what its confirmed scenario says.
- If the emulator now holds roles nobody made (a role it makes for a service, or one left by another check of the same run), the requirement records the direct calls that show which, and the checks and screens treat them as the scenario's intent asks.

## Out of scope

The ECS group of the same run (its own issue). Any other IAM or Lambda work.
