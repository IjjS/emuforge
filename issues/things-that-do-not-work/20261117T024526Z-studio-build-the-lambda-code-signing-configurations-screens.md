Issue-Id: 350
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|code-signing-configurations
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build the Lambda "Code signing configurations" screens

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/lambda/code-signing-configurations` shows the area's "no screen yet" page. The emulator holds code signing configurations and a function's link to one.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda list-code-signing-configs   -> ok, empty on a fresh emulator
$ aws lambda create-code-signing-config --allowed-publishers SigningProfileVersionArns=arn:aws:signer:us-east-1:000000000000:/signing-profiles/p84/abcdefghij --description probe   -> ok, CodeSigningConfigId csc-...
$ aws lambda get-code-signing-config --code-signing-config-arn <arn>   -> ok
$ aws lambda put-function-code-signing-config --function-name p84-a --code-signing-config-arn <arn>   -> ok
$ aws lambda list-functions-by-code-signing-config --code-signing-config-arn <arn>   -> ok, the function's ARN
$ aws lambda delete-function-code-signing-config --function-name p84-a   -> ok
$ aws lambda delete-code-signing-config --code-signing-config-arn <arn>   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a code signing configuration with the AWS CLI.
2. Open `/aws/lambda/code-signing-configurations`.
3. The page says there is no screen yet.

## Expected
- The emulator's code signing configurations are listed and opened with the functions that use each; one can be created, edited and deleted; the emulator's answer is shown.
- The screen says what the requirement finds by calling: whether the emulator checks a function's code against its configuration.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
AWS Signer's own screens. Any engine change. Anything sent to real AWS.
