Issue-Id: 310
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|apigateway|custom-domain-names
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Show and change custom domain names and domain name access associations

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 69 builds the first API Gateway screens (the APIs list, delete from the list, "Choose an API type" and
"Create REST API") and its plan cuts the rest of the service into further issues, as the owner's decision of
2026-11-17 asks for a service too large for one issue. This is one of them.

Group: the navigation entries "Custom domain names" and "Domain name access associations" (captures `03-custom-domain-names`, `04-domain-name-access-associations`): lists, a domain name's page with its API mappings, create and delete.

The screens are built to the AWS screen policy (`studio/AGENTS.md`) the way the S3 bucket list (issue 56) and
the APIs list (issue 69) were. The requirement first finds out again what the emulator answers for each
operation these screens call, on the emulator version the checks then run on; a part whose operations answer
501 is left out and recorded under `omitted`, an action the emulator answers 501 for on a resource it holds
stays and reports it.

Reference: the AWS console of API Gateway, for structure and vocabulary: the owner's captures under
`docs/aws-console/apigateway/` in the main checkout (outside git) and the AWS user guide (API Gateway developer
guide) for every page no capture shows. Nothing of the captures is copied into the repository.

## Evidence

aws-emulator 1.0.481 (release 2026.11.16, commit `677eff0e`), called directly for the plan of issue 69 on 2026-11-17 (scripts and full output in the main checkout under `.pm/issue-69/probe/`, outside git):

- `CreateDomainName` answers and the name is then listed; `GetDomainNameAccessAssociations` answers with none (`probe-2.log`). `CreateDomainNameAccessAssociation` for a domain name ARN that does not exist answers 400 `BadRequestException` "Domain not found" (`probe-3.log`); with a private domain name that exists it was not probed.

Studio has no screen for any of it: `studio/src/providers/aws/area/screens.ts` on `main` lists none for
`/apigateway`, and issue 69's requirement (`.pm/issue-69/requirement.md`, R12) leaves this group out.

## Steps to Reproduce

1. Create a custom domain name in the emulator with any tool.
2. Studio's API Gateway navigation has no entry for it.

## Expected

- The lists show what the emulator holds; a domain name can be created, mapped to an API's stage and deleted, each confirmed directly. Whether the emulator can hold an access association is found by the requirement.
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

- Certificates (ACM) beyond what the form needs to name one.
