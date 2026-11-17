Issue-Id: 84
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|lambda|functions-list
Issue-Check-Ids: studio.lambda-function-create-appears-in-the-emulator studio.lambda-function-create-lists-the-roles-of-the-emulator studio.lambda-function-create-refusals-create-nothing studio.lambda-function-create-repeated-and-abandoned studio.lambda-function-delete-removes-functions-from-the-emulator studio.lambda-function-list-actions-lead-to-their-routes studio.lambda-function-list-empty-emulator-says-no-functions studio.lambda-function-list-filter-matches-the-start-of-a-name studio.lambda-function-list-pages-follow-the-emulator studio.lambda-function-list-rereads-on-open-and-refresh studio.lambda-function-list-shows-loading-until-the-answer studio.lambda-function-list-shows-what-the-emulator-holds studio.lambda-function-page-of-a-missing-function-says-not-found studio.lambda-function-page-shows-the-function studio.lambda-function-screens-follow-emulator-stop-and-restart studio.lambda-function-screens-keyboard-and-layout studio.lambda-function-screens-say-when-the-engine-stops-answering studio.lambda-function-screens-talk-only-to-the-engine
Issue-Commit: fe28fb4faecc4a824bf214f5b547ac759ca7f7aa

# Show the emulator's Lambda functions: the Functions screen

> Identified against commit `fe28fb4faecc4a824bf214f5b547ac759ca7f7aa`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`/aws/lambda` says "no screen yet". AWS Lambda is in Studio's list of services (`studio/src/providers/aws/services.ts`)
and the owner has captures of its console, so it gets its first screen: Functions, the functions the emulator holds,
whoever made them, with the list's own actions.

The screen is built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list was (issue 56): a
`console` screen of the area with its entry in `screens.ts`, its reference spec under
`studio/references/console/lambda/`, its calls through the engine, and the states the policy names.

Before anything is designed, the requirement finds out what the emulator answers for this service: which of the
list's operations it implements, which it answers 501 for, and whether it knows the service at all. If the
emulator does not know the service, this issue is closed out with that evidence and nothing is built.

Scope: the one list. What a row's name leads to and what each action does while its own screen or dialog does
not exist yet is for the requirement to say, as issue 56 settled it for S3.

Reference: the AWS console's "Functions" screen, for structure and vocabulary: the owner's captures under
`docs/aws-console/lambda/` in the main checkout (outside git; `03-event-functions.png` and its neighbours) and the AWS user
guide. Nothing of the captures is copied into the repository.

## Evidence

```
$ grep -n "'/lambda'" studio/src/providers/aws/services.ts
```

lists the service, and `/aws/lambda` renders the area's "no screen yet" page. `studio/references/console/lambda/`
does not exist.

## Steps to Reproduce

1. Start EmuForge, create one of the service's functions in the emulator with any tool, open `/aws/lambda`.
2. The page says there is no screen yet; nothing the emulator holds is shown.

## Expected

- `/aws/lambda` shows the emulator's functions in a Cloudscape table that follows the console's list in structure and
  vocabulary, with only the parts the emulator has; each part left out is recorded in the screen's reference
  spec under `omitted` with its evidence.
- Resources made outside Studio appear; the list is read from the emulator through the engine each time it
  opens or is refreshed, never from a browser cache.
- Loading, empty, the emulator not reachable, and an operation the emulator answers 501 for each have their own
  state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names this screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs read `EmuForge > AWS > Lambda > Functions`.
- The screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state against a real emulator, and compare what the screen shows with what the
  emulator answers directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- A resource's own page and the create, edit and delete flows: each is its own issue.
- Every other entry of the console's navigation for this service.
- Any other service.
