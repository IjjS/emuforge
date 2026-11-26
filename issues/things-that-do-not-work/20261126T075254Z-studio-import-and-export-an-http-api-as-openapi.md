Issue-Id: 654
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|apigateway.http-api|import-export
Issue-Check-Ids:
Issue-Commit: b30f580e277940803854843b7692df685d0a8090

# Import and export an HTTP API as OpenAPI

> Identified against commit `b30f580e277940803854843b7692df685d0a8090`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's API Gateway screens (issue 69) create an HTTP API from a form and show its routes, integrations and stages.
They have no way to create an HTTP API from an OpenAPI document, to replace one from a document, or to read an HTTP
API out as OpenAPI. The emulator answers the three operations of the API Gateway v2 API for it: `ImportApi`,
`ReimportApi` and `ExportApi`. The reference is the same request sent straight to aws-emulator
(`aws apigatewayv2 import-api`, `reimport-api`, `export-api`). The REST side of the same task is issue 306.

## Evidence

Probes of issue 69 against emulator 1.0.625, kept in the main checkout (not tracked):
`.pm/issue-69/probe/probe-2.log` line 523 (`export-api` of an HTTP API, `OAS30`, answered) and line 578
(`import-api` with an OpenAPI 3.0.1 body, answered); `.pm/issue-69/probe/probe-6.log` line 58 (`OK apigatewayv2
reimport-api`) and line 67 (`export-api` of a WebSocket API is refused: 400 `BadRequestException` "Currently,
Exports are not permitted for APIs with a protocol type of WEBSOCKET"). `.pm/issue-69/requirement.md`, "The
service's tasks", task 11, names this issue as its follow-up.

## Steps to Reproduce

1. Start the emulator and Studio, and open `/aws/apigateway/apis`.
2. Look for a way to create an HTTP API from an OpenAPI document, or to export one that exists.
3. There is none: "Create API" offers the form only, and an HTTP API's page has no export.

## Expected

- An HTTP API can be created from an OpenAPI document given as text (`ImportApi`), and the result leads to its page.
- An HTTP API that exists can be replaced from a document (`ReimportApi`).
- An HTTP API's page gives its OpenAPI 3.0 export as text with a copy control (`ExportApi`).
- A WebSocket API offers no export, shown as unavailable with the emulator's reason.
- A document the emulator refuses leaves the form open with the operation's name and the reason.

## Out of scope

REST API import and export (issue 306). Reading a file from a URL: a document is pasted or chosen from disk, never
fetched.
