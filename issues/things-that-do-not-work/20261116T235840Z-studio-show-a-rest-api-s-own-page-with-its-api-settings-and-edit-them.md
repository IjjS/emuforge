Issue-Id: 303
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|apigateway|rest-api-page-and-edit
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Show a REST API's own page with its API settings, and edit them

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 69 builds the first API Gateway screens (the APIs list, delete from the list, "Choose an API type" and
"Create REST API") and its plan cuts the rest of the service into further issues, as the owner's decision of
2026-11-17 asks for a service too large for one issue. This is one of them.

Group: the REST API's own page, which an API's name on the APIs list leads to (`/aws/apigateway/apis/<id>`, the "no screen yet" page until this issue), with the console's "API settings" ("API details": name, description, endpoint type, IP address type, default endpoint, security policy, endpoint access mode, API key source, binary media types, minimum compression size) and "Edit" with "Save changes". After this issue "Create API" of issue 69's form can lead to the new API's page.

The screens are built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list (issue 56) and
the APIs list (issue 69) were. The requirement first finds out again what the emulator answers for each
operation these screens call, on the emulator version the checks then run on; a part whose operations answer
501 is left out and recorded under `omitted`, an action the emulator answers 501 for on a resource it holds
stays and reports it.

Depends on the harness issue "Let pm-structure score a screen whose route holds an id the emulator assigns": the page's route holds the API's id.

Reference: the AWS console of API Gateway, for structure and vocabulary: the owner's captures under
`docs/aws-console/apigateway/` in the main checkout (outside git) and the AWS user guide (API Gateway developer
guide) for every page no capture shows. Nothing of the captures is copied into the repository.

## Evidence

aws-emulator 1.0.481 (release 2026.11.16, commit `677eff0e`), called directly for the plan of issue 69 on 2026-11-17 (scripts and full output in the main checkout under `.pm/issue-69/probe/`, outside git):

- `apigateway:GetRestApi` answers 200 by id; an unknown id answers 404 `NotFoundException` "Invalid API identifier specified 000000000000:<id>" (`probe-2.log`, `probe-3.log`).
- `apigateway:UpdateRestApi` stores patches of the name, description, API key source, `disableExecuteApiEndpoint`, minimum compression size, binary media types, security policy and IP address type; the endpoint type patch `/endpointConfiguration/types/REGIONAL` answers 400 "Invalid patch operation specified" (`probe-2.log`).

Studio has no screen for any of it: `studio/src/providers/aws/area/screens.ts` on `main` lists none for
`/apigateway`, and issue 69's requirement (`.pm/issue-69/requirement.md`, R12) leaves this group out.

## Steps to Reproduce

1. Start EmuForge, create a REST API in the emulator with any tool, open `/aws/apigateway` and choose its name.
2. The page says Studio has no screen yet; nothing shows or changes the API's settings.

## Expected

- An API's name on the APIs list opens the API's page, which shows what `GetRestApi` returns, compared with a direct call.
- "Edit" changes each setting the emulator stores, confirmed by a direct `GetRestApi`; a setting the emulator refuses to change reports the emulator's answer.
- A link to an API that no longer exists says so.
- Resources made outside Studio appear; everything is read from the emulator through the engine each time a
  screen opens or is refreshed, never from a browser cache.
- A destructive action asks for confirmation the way the console does, and says it acts on the local emulator.
- Loading, empty, the emulator not reachable, a refused request and an operation the emulator answers 501 for
  each have their own state in EmuForge's own words, in Cloudscape's patterns for them.
- Each screen has a reference spec under `studio/references/console/apigateway/`, passes the structure score
  against it and the critique, and carries the emulator line; a screen that shows resources carries the
  local-emulator notice worded for them. Breadcrumbs start `EmuForge > AWS > API Gateway`.
- Integration checks run every state and every action against a real emulator and confirm each change by
  asking the emulator directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- Resources, methods, stages and everything else an API holds (their own issues).
- HTTP and WebSocket APIs' pages.
