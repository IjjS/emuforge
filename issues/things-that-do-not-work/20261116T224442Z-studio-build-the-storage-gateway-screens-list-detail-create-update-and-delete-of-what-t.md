Issue-Id: 271
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|storagegateway|service-screens
Issue-Check-Ids:
Issue-Commit: a90c718db39c8be1555ceb5aa4d341463e7341fb

# Build the Storage Gateway screens: list, detail, create, update and delete of what the emulator holds

> Identified against commit `a90c718db39c8be1555ceb5aa4d341463e7341fb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio has no screen for Storage Gateway (console id `storagegateway`), and the service is not in Studio's list of services (`studio/src/providers/aws/services.ts`). The owner has captures of its console.

The owner's decision (2026-11-17): every service the emulator supports gets its screens, and an issue covers the
service whole, not one list. Scope: every part of the service's console that shows or changes resources the
emulator holds: the lists, a resource's own page, create, update, delete, and the service's own actions on a
resource. The service is added to Studio's list with the label rule that file states, once the requirement has shown that the emulator holds resources for it.

The screens are built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list was (issue 56):
`console` screens of the area with their entries in `screens.ts`, a reference spec per screen under
`studio/references/console/<service>/`, calls through the engine, and the states the policy names.

Before anything is designed, the requirement finds out what the emulator answers for this service. The emulator
accepts the API of every service that has a model and answers HTTP 501 `NotImplemented` for an operation it
does not implement, so "supported" is decided per operation, against the emulator the checks run on:

- If the emulator implements none of the service's list operations, or the console entry is not a service with
  resources of its own (an account, billing, marketing or tool page), the issue is closed out with that evidence
  and nothing is built.
- A part of the console whose operations answer 501 is left out and recorded under `omitted` in the reference
  spec; an action the emulator answers 501 for on a resource it does hold stays, as the policy says.

The breakdown starts with the main resource's list, then its own page, create, update and delete, then the next
resource. A service too large to finish as one issue is cut by the plan: this issue keeps the main resources,
and the plan files each further group of resources as its own issue file, in the order they should land.

Reference: the AWS console of this service, for structure and vocabulary: the owner's captures under
`docs/aws-console/storagegateway/` in the main checkout (outside git; 7 captures) and the AWS user guide. The captures
show the console's navigation and lists; where no capture exists for a page (a create form, a resource's own
page), the user guide and the API's model give its fields. Nothing of the captures is copied into the repository.

## Evidence

`studio/src/providers/aws/services.ts` has no entry for the service; `docs/aws-console/storagegateway/` holds 7 captures of its console.

## Steps to Reproduce

1. Start EmuForge, create one of the service's resources in the emulator with any tool, open the service in the
   AWS area.
2. No screen shows it, and nothing in Studio can create, change or delete it.

## Expected

- Each resource the emulator holds for this service has a list in a Cloudscape table that follows the console's
  in structure and vocabulary, a page of its own, and create, update and delete where the emulator implements
  them, each confirmed against what the emulator then answers directly.
- Resources made outside Studio appear; everything is read from the emulator through the engine each time a
  screen opens or is refreshed, never from a browser cache.
- A destructive action asks for confirmation the way the console does, and says it acts on the local emulator.
- Loading, empty, the emulator not reachable, a refused request and an operation the emulator answers 501 for
  each have their own state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names each screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs start `EmuForge > AWS > <service>`.
- Each screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state and every action against a real emulator.
- Nothing is sent to real AWS; no key reaches the browser; a secret value is shown only when the user asks for it.

## Out of scope

- Any other service.
- Parts of the console the emulator does not implement.
