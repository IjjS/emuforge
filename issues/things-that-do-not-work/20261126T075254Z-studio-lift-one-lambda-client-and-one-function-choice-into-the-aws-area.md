Issue-Id: 656
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.lambda-function-choice|lift
Issue-Check-Ids:
Issue-Commit: b30f580e277940803854843b7692df685d0a8090

# Lift one Lambda client and one function choice into the AWS area

> Identified against commit `b30f580e277940803854843b7692df685d0a8090`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A service folder of the AWS area imports nothing from another service folder; what two services share moves to the
area when the second one needs it (`studio/AGENTS.md`, "Stack and structure"). Choosing a Lambda function the
emulator holds is now needed by three services, each with a Lambda client and a function choice of its own: Lambda
itself, SNS (the endpoint of a subscription) and, with issue 69, API Gateway (the integration of a method or a
route). Issue 69 was told to edit no shared file of the area, so it added a third copy rather than lifting one.

## Evidence

At the commit above: `studio/src/providers/aws/area/services/lambda/api.ts` (`ListFunctionsCommand`, line 20) and
`studio/src/providers/aws/area/services/sns/api.ts` (`ListFunctionsCommand`, lines 6 and 558 to 568, "One page of
`ListFunctions`, `MaxItems` 50") with `sns/components/endpoint-select.tsx`. Issue 69 adds
`services/apigateway/lambda-api.ts` and `services/apigateway/components/function-field.tsx`
(`.pm/issue-69/breakdown.md`, unit `s7`; `.pm/issue-69/design.md`, "own Lambda client in `lambda-api.ts`").

## Steps to Reproduce

1. `grep -rl ListFunctionsCommand studio/src/providers/aws/area/services` on a `main` that holds issue 69.
2. Three service folders answer: `lambda`, `sns` and `apigateway`.

## Expected

- One read of a page of Lambda functions and one function choice are in the area's shared folders, and the three
  services use them.
- No service folder but `lambda` constructs a request to Lambda's `ListFunctions` of its own.
- The screens of the three services show what they showed before; their checks pass unchanged.

## Out of scope

Lambda's `AddPermission` and `GetPolicy` used by API Gateway alone, which stay in its folder until a second service
needs them.
