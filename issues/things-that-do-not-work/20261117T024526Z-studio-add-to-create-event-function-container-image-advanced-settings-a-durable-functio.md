Issue-Id: 352
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|create-function-more
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Add to "Create Event Function": "Container image", "Advanced settings", a durable function, every runtime the emulator accepts

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Create Event Function" (issue 84) creates a function from starter code in one of four runtimes. Its section "Advanced settings" is the one item of the reference spec `studio/references/console/lambda/create-function.yaml` that issue 84 leaves unbuilt, and it offers neither "Container image" nor a durable function. The emulator accepts more than the form sends.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda create-function --function-name p84-image --package-type Image --role <role> --code ImageUri=000000000000.dkr.ecr.us-east-1.amazonaws.com/p84:latest   -> InvalidParameterValueException "Source image ... does not exist. ..." (so the emulator looks the image up)
$ aws lambda create-function ... --code S3Bucket=p84-missing-bucket,S3Key=x.zip   -> InvalidParameterValueException "Error occurred while GetObject. S3 Error Code: NoSuchBucket. ..."
$ aws lambda create-function --function-name q84-durable ... --durable-config ExecutionTimeout=60,RetentionPeriodInDays=1   -> ok; list-functions returns the item with DurableConfig
$ aws lambda create-function with each of nodejs24.x ... nodejs18.x and python2.7   -> ok; --runtime cobol99 -> ValidationException (the constraint of `runtime`)
$ aws lambda create-function ... --tags team=probe   -> ok; list-tags returns the tag
$ aws lambda put-function-code-signing-config on a function   -> ok
Not called: create-function with --vpc-config or --code-signing-config-arn; an image that exists in the emulator's ECR.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/lambda/functions/create`.
3. There is no section "Advanced settings", no "Container image" and no way to make a durable function; "Runtime" offers four runtimes.

## Expected
- The form has the section "Advanced settings" and sends what it holds; the spec's item matches (22/22).
- A function can be created from a container image of the emulator's ECR and from a .zip file in a bucket of the emulator's S3; the emulator's refusal for an image or object that does not exist is shown as it came.
- A durable function can be created; the list shows it as "Durable" (it does already).
- "Runtime" offers the runtimes the requirement finds the emulator runs, by invoking a function of each.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Blueprints and the serverless application repository. Uploading code after creation (the code issue). Any engine change. Anything sent to real AWS.
