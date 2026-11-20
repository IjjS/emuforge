Issue-Id: 614
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ecs.account-settings|task
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Build ECS's account settings screen

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
ECS's screens (issue 575) build tasks 1 to 6 of the tasks a developer does with ECS locally; task 12 was below the
cut and is filed here, as the requirement of issue 575 said (R2, "filed"). A developer cannot see or change ECS's account settings in Studio.

The reference is the same request sent straight to aws-emulator: `ListAccountSettings`, `PutAccountSetting`. The AWS console's screens are a reference of
UX only; the screens serve the task as far as the emulator's API supports it (`studio/references/aws-area.md`).

## Evidence
Probed for issue 575 against aws-emulator 1.0.533 with the AWS CLI 2.34.53 on 2026-11-20 (`.pm/archive/575.md` names the requirement; the emulator was one of the probe's own, stopped after):

```
$ aws ecs list-account-settings
{
    "settings": []
}
$ aws ecs put-account-setting --name containerInsights --value enabled
{"setting":{"name":"containerInsights","value":"enabled","principalArn":"arn:aws:iam::000000000000:user/emulator","type":"user"}}
[exit 0]
```

## Steps to Reproduce
1. Start a fresh emulator and open Studio's ECS screens (`/aws/ecs`).
2. Look for the task on the cluster's, the service's, the task's and the task definitions' pages: no screen offers it.
3. Send the commands of Evidence to the emulator: it answers them.

## Expected
- A screen of ECS lists the account settings the emulator's `ListAccountSettings` answers.
- A setting changed there is what the emulator then lists.

## Out of scope
- Settings the emulator refuses or does not act on are shown as it answers them, not hidden.
