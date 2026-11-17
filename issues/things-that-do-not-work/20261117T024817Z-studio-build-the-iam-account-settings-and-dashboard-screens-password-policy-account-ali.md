Issue-Id: 366
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|account-settings-and-dashboard
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM "Account settings" and "Dashboard" screens: password policy, account alias, account summary

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/iam/account-settings` and the console's IAM "Dashboard" have no screen. The emulator answers the account's password policy, alias and summary.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam get-account-summary   -> 200
$ aws iam list-account-aliases   -> 200
$ aws iam get-account-password-policy / update-account-password-policy / delete-account-password-policy / create-account-alias / delete-account-alias   -> answered (200 or a 4xx of its own), none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/account-settings`.
3. The page says there is no screen yet.


## Expected
- "Account settings" shows and changes the password policy and the account alias; "Dashboard" shows the account's summary (a `detail` spec with sections); a part the emulator does not have is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Security Token Service endpoint settings unless the requirement finds the emulator holds them. Billing. Any engine change. Anything sent to real AWS.
