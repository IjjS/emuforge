Issue-Id: 346
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|function-configuration
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build a Lambda function's "Configuration" tab: general configuration, environment variables, tags, permissions, concurrency, asynchronous invocation, function URL

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A function's tab "Configuration" (issue 84) leads to `/aws/lambda/functions/function/<name>/configuration`, which shows the area's "no screen yet" page; a function's page shows the function URL as text only and none of the other settings. The emulator stores every one of them.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda update-function-configuration --function-name p84-py --description changed --timeout 30 --memory-size 512 --environment Variables={X=y}   -> ok, read back by get-function-configuration
$ aws lambda update-function-configuration --function-name p84-missing --timeout 5   -> ResourceNotFoundException
$ aws lambda tag-resource / list-tags / untag-resource   -> ok, the tags read back
$ aws lambda add-permission --function-name p84-py --statement-id s1 --action lambda:InvokeFunction --principal s3.amazonaws.com   -> ok; get-policy -> ok with the statement; remove-permission -> ok
$ aws lambda get-policy --function-name p84-js (no statement)   -> ResourceNotFoundException "The resource you requested does not exist."
$ aws lambda put-function-concurrency --reserved-concurrent-executions 3 / get-function-concurrency / delete-function-concurrency   -> ok
$ aws lambda put-function-event-invoke-config --maximum-retry-attempts 1 / get- / delete-   -> ok
$ aws lambda create-function-url-config --function-name p84-js --auth-type NONE   -> ok, FunctionUrl https://127.0.0.1:<port>/_aws/lambda-url/<id>/
$ aws lambda update-function-url-config --auth-type AWS_IAM / delete-function-url-config   -> ok
$ aws lambda get-function-recursion-config / put-function-recursion-config / get-runtime-management-config / put-runtime-management-config   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and the function's page.
3. Choose the tab "Configuration".
4. The page says there is no screen yet.

## Expected
- The tab shows the function's general configuration, environment variables, tags, execution role and resource-based policy, concurrency, asynchronous invocation and function URL, and each can be edited; the emulator's answer, a refusal included, is shown.
- An environment variable's value is shown only on the user's action and is never stored or logged by Studio.
- The screen says that the emulator stores the resource-based policy; whether anything evaluates it is for the requirement to find out.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Triggers and event source mappings, layers, code signing, VPC and capacity providers (their own issues). IAM evaluation by the engine. Any engine change. Anything sent to real AWS.
