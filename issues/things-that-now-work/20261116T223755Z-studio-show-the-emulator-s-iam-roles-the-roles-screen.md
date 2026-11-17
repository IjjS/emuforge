Issue-Id: 82
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|iam|roles-list
Issue-Check-Ids: studio.iam-role-create-appears-in-the-emulator studio.iam-role-create-refusals-create-nothing studio.iam-role-create-repeated-and-abandoned studio.iam-role-delete-removes-roles-from-the-emulator studio.iam-role-edit-summary-changes-the-emulator studio.iam-role-list-empty-emulator-says-no-roles studio.iam-role-list-filter-matches-part-of-a-name studio.iam-role-list-pages-follow-the-emulator studio.iam-role-list-rereads-on-open-and-refresh studio.iam-role-list-shows-loading-until-the-answer studio.iam-role-list-shows-what-the-emulator-holds studio.iam-role-page-of-a-missing-role-says-not-found studio.iam-role-page-shows-the-role studio.iam-role-screens-actions-lead-to-their-routes studio.iam-role-screens-follow-emulator-stop-and-restart studio.iam-role-screens-keyboard-and-layout studio.iam-role-screens-say-when-the-engine-stops-answering studio.iam-role-screens-talk-only-to-the-engine
Issue-Commit: fe28fb4faecc4a824bf214f5b547ac759ca7f7aa

# Show the emulator's IAM roles: the Roles screen

> Identified against commit `fe28fb4faecc4a824bf214f5b547ac759ca7f7aa`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`/aws/iam` says "no screen yet". AWS Identity and Access Management is in Studio's list of services (`studio/src/providers/aws/services.ts`)
and the owner has captures of its console, so it gets its first screen: Roles, the roles the emulator holds,
whoever made them, with the list's own actions.

The screen is built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list was (issue 56): a
`console` screen of the area with its entry in `screens.ts`, its reference spec under
`studio/references/console/iam/`, its calls through the engine, and the states the policy names.

Users, groups and policies are their own issues; EmuForge's own IAM simulation is a different screen and is not part of this.

Before anything is designed, the requirement finds out what the emulator answers for this service: which of the
list's operations it implements, which it answers 501 for, and whether it knows the service at all. If the
emulator does not know the service, this issue is closed out with that evidence and nothing is built.

Scope: the one list. What a row's name leads to and what each action does while its own screen or dialog does
not exist yet is for the requirement to say, as issue 56 settled it for S3.

Reference: the AWS console's "Roles" screen, for structure and vocabulary: the owner's captures under
`docs/aws-console/iam/` in the main checkout (outside git; `02-roles.png` and its neighbours) and the AWS user
guide. Nothing of the captures is copied into the repository.

## Evidence

```
$ grep -n "'/iam'" studio/src/providers/aws/services.ts
```

lists the service, and `/aws/iam` renders the area's "no screen yet" page. `studio/references/console/iam/`
does not exist.

## Steps to Reproduce

1. Start EmuForge, create one of the service's roles in the emulator with any tool, open `/aws/iam`.
2. The page says there is no screen yet; nothing the emulator holds is shown.

## Expected

- `/aws/iam` shows the emulator's roles in a Cloudscape table that follows the console's list in structure and
  vocabulary, with only the parts the emulator has; each part left out is recorded in the screen's reference
  spec under `omitted` with its evidence.
- Resources made outside Studio appear; the list is read from the emulator through the engine each time it
  opens or is refreshed, never from a browser cache.
- Loading, empty, the emulator not reachable, and an operation the emulator answers 501 for each have their own
  state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names this screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs read `EmuForge > AWS > IAM > Roles`.
- The screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state against a real emulator, and compare what the screen shows with what the
  emulator answers directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- A resource's own page and the create, edit and delete flows: each is its own issue.
- Every other entry of the console's navigation for this service.
- Any other service.
