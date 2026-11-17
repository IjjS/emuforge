Issue-Id: 348
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|layers
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build the Lambda layer screens: "Layers", a layer's versions, create a layer, delete a version, a function's layers

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/lambda/layers` shows the area's "no screen yet" page, and a function's page (issue 84) does not show its layers. The emulator holds layers and their versions.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda publish-layer-version --layer-name p84-layer --zip-file fileb://py.zip --compatible-runtimes python3.13   -> ok, Version 1, Content with CodeSize and a signed Location
$ aws lambda publish-layer-version (again)   -> ok, Version 2
$ aws lambda list-layers / list-layer-versions --layer-name p84-layer / get-layer-version --version-number 1   -> ok
$ aws lambda add-layer-version-permission / get-layer-version-policy   -> answered, none 501
$ aws lambda update-function-configuration --function-name p84-a --layers arn:aws:lambda:us-east-1:000000000000:layer:p84-layer:1   -> ok
$ aws lambda delete-layer-version --layer-name p84-layer --version-number 2   -> ok; list-layer-versions then holds version 1 only
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and publish a layer version with the AWS CLI.
2. Open `/aws/lambda/layers`.
3. The page says there is no screen yet.

## Expected
- The emulator's layers are listed; a layer's versions are listed; a layer version can be created from a .zip file and deleted; a function's layers are shown and can be changed; the emulator's answer is shown.
- A layer's signed address is never shown, stored or logged.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Sharing a layer with other accounts unless the requirement takes it up. Any engine change. Anything sent to real AWS.
