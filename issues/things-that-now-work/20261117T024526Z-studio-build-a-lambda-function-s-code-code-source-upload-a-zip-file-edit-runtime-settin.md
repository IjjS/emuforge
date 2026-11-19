Issue-Id: 344
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|function-code
Issue-Check-Ids: studio.lambda-upload-zip-changes-the-code studio.lambda-upload-refusals-leave-the-code studio.lambda-configuration-edits-reach-the-emulator
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build a Lambda function's code: "Code source", upload a .zip file, edit "Runtime settings"

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A function's page (issue 84) shows "Runtime settings" (runtime, handler, architecture) as text and has no section "Code source": it is the one item of the reference spec `studio/references/console/lambda/function-detail.yaml` that issue 84 leaves unbuilt. The emulator keeps a function's code and gives a signed address for it, and it answers the operations that change the code and the runtime settings.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda get-function --function-name p84-js   -> ok, Configuration (CodeSize 229, Handler index.handler, Runtime nodejs22.x) and Code.Location, a signed address on the emulator's own port
$ aws lambda update-function-configuration --function-name p84-py --description changed --timeout 30 --memory-size 512 --environment Variables={X=y} --handler index.handler   -> ok, LastUpdateStatus InProgress; Successful 3.8 s later
$ aws lambda update-function-configuration --function-name p84-py --runtime nodejs22.x (while that update is in progress)   -> ResourceConflictException "The operation cannot be performed at this time. An update is in progress for resource: ..."
$ aws lambda update-function-code --function-name p84-py --zip-file fileb://js.zip (while that update is in progress)   -> ResourceConflictException, the same message
Not called: update-function-code on a function with no update in progress.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and the function's page.
3. The page has no section "Code source", and "Runtime settings" cannot be edited.

## Expected
- The "Code" tab has the section "Code source": the function's files are shown as text, and a .zip file can be uploaded; the spec's item matches (29/29).
- "Runtime settings" can be edited (runtime, handler); while an update is in progress the page says so, and the emulator's refusal of a second update is shown as it came.
- The signed address of the code is never shown, stored or logged.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
An editor that runs or tests code ("Test" is its own issue). Layers. Container images. Any engine change. Anything sent to real AWS.
