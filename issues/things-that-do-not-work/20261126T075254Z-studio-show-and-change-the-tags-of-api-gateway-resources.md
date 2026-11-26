Issue-Id: 655
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|apigateway|tags
Issue-Check-Ids:
Issue-Commit: b30f580e277940803854843b7692df685d0a8090

# Show and change the tags of API Gateway resources

> Identified against commit `b30f580e277940803854843b7692df685d0a8090`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's API Gateway screens (issue 69) show and change APIs, resources, methods, routes, integrations and stages,
and nothing of their tags. The emulator answers the tag operations of both API models except one: v1 `GetTags`,
`TagResource` and `UntagResource`, v2 `GetTags` and `UntagResource` answer, and v2 `TagResource` answers 501. The
reference is the same request sent straight to aws-emulator (`aws apigateway get-tags`, `aws apigatewayv2
get-tags` and their tag and untag commands).

## Evidence

Probes of issue 69 against emulator 1.0.625, kept in the main checkout (not tracked):
`.pm/issue-69/probe/probe-3.log` lines 151 to 160 (v1 `get-tags`, `tag-resource`, `untag-resource` on a REST API,
answered); `.pm/issue-69/probe/probe-2.log` lines 504 to 517 (v2 `get-tags` and `untag-resource` answered;
`tag-resource`: "An error occurred (NotImplemented) when calling the TagResource operation: operation TagResource
is scaffolded but not implemented in this emulator"). `.pm/issue-69/requirement.md`, "The service's tasks", task
15, names this issue as its follow-up.

## Steps to Reproduce

1. Start the emulator, create a REST API and tag it: `aws apigateway tag-resource --resource-arn
   arn:aws:apigateway:us-east-1::/restapis/<id> --tags x=y`.
2. Open that API's page in Studio (`/aws/apigateway/apis/rest/<id>`).
3. The tag is not shown, and there is no way to add or remove one.

## Expected

- A REST API's page and an HTTP or WebSocket API's page show the API's tags as the emulator holds them.
- A REST API's tags can be added and removed (`TagResource`, `UntagResource`).
- An HTTP or WebSocket API's tags can be removed (`UntagResource`); adding one is shown as unavailable with "Not
  implemented by the emulator" and `TagResource`, for as long as the emulator answers 501.

## Out of scope

Tags of stages and of the resource kinds that have no screen yet. The 501 of v2 `TagResource` itself is an emulator
gap, not an EmuForge issue.
