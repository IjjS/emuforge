Issue-Id: 75
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|events|event-buses-list
Issue-Check-Ids: studio.events-buses-made-outside-are-listed studio.events-bus-list-pages studio.events-create-bus-with-description-and-tags studio.events-create-bus-existing-name-is-refused studio.events-bus-description-and-tags-change studio.events-delete-bus-from-the-list studio.events-delete-bus-with-rules-is-refused studio.events-delete-bus-from-its-page studio.events-bus-page-shows-its-rules studio.events-rules-entry-lists-a-chosen-bus studio.events-rule-page-shows-rule-and-targets studio.events-rule-names-of-dots-open-by-their-address studio.events-missing-bus-and-rule-are-not-found studio.events-create-rule-with-targets studio.events-create-rule-existing-name-is-refused studio.events-create-rule-refused-pattern-leaves-no-rule studio.events-create-schedule-rule-on-default studio.events-rule-switch-off-and-on studio.events-add-and-remove-target studio.events-delete-rule-with-targets studio.events-sent-event-reaches-a-matching-rules-queue studio.events-bus-from-the-address-must-be-in-the-emulator studio.events-entries-lead-to-a-screen-or-no-screen-yet
Issue-Commit: fe28fb4faecc4a824bf214f5b547ac759ca7f7aa

# Show the emulator's EventBridge event buses: the Event buses screen

> Identified against commit `fe28fb4faecc4a824bf214f5b547ac759ca7f7aa`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`/aws/events` says "no screen yet". Amazon EventBridge is in Studio's list of services (`studio/src/providers/aws/services.ts`)
and the owner has captures of its console, so it gets its first screen: Event buses, the event buses the emulator holds,
whoever made them, with the list's own actions.

The screen is built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list was (issue 56): a
`console` screen of the area with its entry in `screens.ts`, its reference spec under
`studio/references/console/events/`, its calls through the engine, and the states the policy names.

Before anything is designed, the requirement finds out what the emulator answers for this service: which of the
list's operations it implements, which it answers 501 for, and whether it knows the service at all. If the
emulator does not know the service, this issue is closed out with that evidence and nothing is built.

Scope: the one list. What a row's name leads to and what each action does while its own screen or dialog does
not exist yet is for the requirement to say, as issue 56 settled it for S3.

Reference: the AWS console's "Event buses" screen, for structure and vocabulary: the owner's captures under
`docs/aws-console/events/` in the main checkout (outside git; `06-event-buses.png` and its neighbours) and the AWS user
guide. Nothing of the captures is copied into the repository.

## Evidence

```
$ grep -n "'/events'" studio/src/providers/aws/services.ts
```

lists the service, and `/aws/events` renders the area's "no screen yet" page. `studio/references/console/events/`
does not exist.

## Steps to Reproduce

1. Start EmuForge, create one of the service's event buses in the emulator with any tool, open `/aws/events`.
2. The page says there is no screen yet; nothing the emulator holds is shown.

## Expected

- `/aws/events` shows the emulator's event buses in a Cloudscape table that follows the console's list in structure and
  vocabulary, with only the parts the emulator has; each part left out is recorded in the screen's reference
  spec under `omitted` with its evidence.
- Resources made outside Studio appear; the list is read from the emulator through the engine each time it
  opens or is refreshed, never from a browser cache.
- Loading, empty, the emulator not reachable, and an operation the emulator answers 501 for each have their own
  state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names this screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs read `EmuForge > AWS > EventBridge > Event buses`.
- The screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state against a real emulator, and compare what the screen shows with what the
  emulator answers directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- A resource's own page and the create, edit and delete flows: each is its own issue.
- Every other entry of the console's navigation for this service.
- Any other service.
