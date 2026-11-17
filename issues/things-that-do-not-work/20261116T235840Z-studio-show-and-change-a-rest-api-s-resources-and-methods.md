Issue-Id: 304
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|apigateway|rest-api-resources-and-methods
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Show and change a REST API's resources and methods

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 69 builds the first API Gateway screens (the APIs list, delete from the list, "Choose an API type" and
"Create REST API") and its plan cuts the rest of the service into further issues, as the owner's decision of
2026-11-17 asks for a service too large for one issue. This is one of them.

Group: the console's "Resources" page of a REST API: the resource tree, "Create resource", "Delete", a resource's methods, "Create method" with its integration (mock, HTTP, Lambda and the others the emulator stores), the method's request, integration request, integration response and method response, and deleting a method.

The screens are built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list (issue 56) and
the APIs list (issue 69) were. The requirement first finds out again what the emulator answers for each
operation these screens call, on the emulator version the checks then run on; a part whose operations answer
501 is left out and recorded under `omitted`, an action the emulator answers 501 for on a resource it holds
stays and reports it.

Depends on the REST API's own page.

Reference: the AWS console of API Gateway, for structure and vocabulary: the owner's captures under
`docs/aws-console/apigateway/` in the main checkout (outside git) and the AWS user guide (API Gateway developer
guide) for every page no capture shows. Nothing of the captures is copied into the repository.

## Evidence

aws-emulator 1.0.481 (release 2026.11.16, commit `677eff0e`), called directly for the plan of issue 69 on 2026-11-17 (scripts and full output in the main checkout under `.pm/issue-69/probe/`, outside git):

- `GetResources`, `CreateResource`, `PutMethod`, `PutIntegration`, `PutMethodResponse` and `PutIntegrationResponse` answer for a REST API made in the probe (`probe-2.log`). A new API has a root resource (`rootResourceId` in the answer of `CreateRestApi`). The delete operations were not probed.

Studio has no screen for any of it: `studio/src/providers/aws/area/screens.ts` on `main` lists none for
`/apigateway`, and issue 69's requirement (`.pm/issue-69/requirement.md`, R12) leaves this group out.

## Steps to Reproduce

1. Create a REST API with a resource and a method in the emulator with any tool.
2. Nothing in Studio shows the resource tree or the method.

## Expected

- The resources of an API are shown as the console arranges them, and resources and methods can be created and deleted, each confirmed by a direct call.
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

- Stages and deployments ("Deploy API"), authorizers, models and the rest (their own issues).
- Invoking the API ("Test").
