Issue-Id: 345
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|function-test
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build a Lambda function's "Test" tab: invoke with an event, show the result and the log tail

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A function's tab "Test" (issue 84) leads to `/aws/lambda/functions/function/<name>/test`, which shows the area's "no screen yet" page. The emulator runs a function's code on `Invoke`.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda invoke --function-name p84-py --payload '{"k":"v"}' out.json   -> StatusCode 200, ExecutedVersion $LATEST; the payload is the handler's result {"ok": true, "echo": {"k": "v"}}
$ aws lambda invoke --function-name p84-js --payload '{"k":"v"}' --log-type Tail out.json   -> StatusCode 200 with LogResult (base64: START RequestId ..., END ..., REPORT ...)
$ aws lambda invoke --function-name p84-py --invocation-type Event   -> StatusCode 202
$ aws lambda invoke --function-name p84-py --invocation-type DryRun   -> StatusCode 204
$ aws lambda invoke --function-name p84-missing   -> ResourceNotFoundException "Function not found: arn:aws:lambda:us-east-1:000000000000:function:p84-missing:$LATEST"
$ aws lambda invoke --function-name p84-py --payload 'not json'   -> InvalidRequestContentException "Could not parse request body into json ..."
$ aws lambda invoke of a function whose State is Pending   -> ResourceConflictException naming the state Pending
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and the function's page.
3. Choose the tab "Test".
4. The page says there is no screen yet.

## Expected
- An event typed as JSON is sent with `Invoke`; the result, a function error and the log tail are shown as text; the emulator's refusal (the function not found, still `Pending`, an event that is not JSON) is shown as it came.
- Nothing is invoked without the user's action.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Saved test events. Asynchronous invocation's settings (the "Configuration" issue). Monitoring. Any engine change. Anything sent to real AWS.
