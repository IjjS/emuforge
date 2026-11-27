Issue-Id: 70
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|cloudwatch|alarms-list
Issue-Check-Ids: 70
Issue-Commit: fe28fb4faecc4a824bf214f5b547ac759ca7f7aa

# Show the emulator's CloudWatch alarms: the Alarms screen

> Identified against commit `fe28fb4faecc4a824bf214f5b547ac759ca7f7aa`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`/aws/cloudwatch` says "no screen yet". Amazon CloudWatch is in Studio's list of services (`studio/src/providers/aws/services.ts`)
and the owner has captures of its console, so it gets its first screen: Alarms, the alarms the emulator holds,
whoever made them, with the list's own actions.

The screen is built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list was (issue 56): a
`console` screen of the area with its entry in `screens.ts`, its reference spec under
`studio/references/console/cloudwatch/`, its calls through the engine, and the states the policy names.

The console opens CloudWatch on an overview that is mostly about metrics of real AWS accounts; the first screen here is the alarm list. If the emulator holds no alarms API, the requirement picks the first list it does hold and says why.

Before anything is designed, the requirement finds out what the emulator answers for this service: which of the
list's operations it implements, which it answers 501 for, and whether it knows the service at all. If the
emulator does not know the service, this issue is closed out with that evidence and nothing is built.

Scope: the one list. What a row's name leads to and what each action does while its own screen or dialog does
not exist yet is for the requirement to say, as issue 56 settled it for S3.

Reference: the AWS console's "Alarms" screen, for structure and vocabulary: the owner's captures under
`docs/aws-console/cloudwatch/` in the main checkout (outside git; `04-alarms.png` and its neighbours) and the AWS user
guide. Nothing of the captures is copied into the repository.

## Evidence

```
$ grep -n "'/cloudwatch'" studio/src/providers/aws/services.ts
```

lists the service, and `/aws/cloudwatch` renders the area's "no screen yet" page. `studio/references/console/cloudwatch/`
does not exist.

## Steps to Reproduce

1. Start EmuForge, create one of the service's alarms in the emulator with any tool, open `/aws/cloudwatch`.
2. The page says there is no screen yet; nothing the emulator holds is shown.

## Expected

- `/aws/cloudwatch` shows the emulator's alarms in a Cloudscape table that follows the console's list in structure and
  vocabulary, with only the parts the emulator has; each part left out is recorded in the screen's reference
  spec under `omitted` with its evidence.
- Resources made outside Studio appear; the list is read from the emulator through the engine each time it
  opens or is refreshed, never from a browser cache.
- Loading, empty, the emulator not reachable, and an operation the emulator answers 501 for each have their own
  state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names this screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs read `EmuForge > AWS > CloudWatch > Alarms`.
- The screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state against a real emulator, and compare what the screen shows with what the
  emulator answers directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- A resource's own page and the create, edit and delete flows: each is its own issue.
- Every other entry of the console's navigation for this service.
- Any other service.
