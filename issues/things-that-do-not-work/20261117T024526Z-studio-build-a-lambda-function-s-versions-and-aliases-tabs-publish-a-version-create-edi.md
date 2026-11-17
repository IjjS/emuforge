Issue-Id: 347
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|versions-and-aliases
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build a Lambda function's "Versions" and "Aliases" tabs: publish a version, create, edit and delete an alias

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A function's tabs "Aliases" and "Versions" (issue 84) lead to `/aws/lambda/functions/function/<name>/aliases` and `…/versions`, which show the area's "no screen yet" page. The emulator holds versions and aliases.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda publish-version --function-name p84-js --description v1   -> ok, Version 1
$ aws lambda list-versions-by-function --function-name p84-js   -> ok, $LATEST and the published versions
$ aws lambda get-function --function-name p84-js --qualifier 1   -> ok
$ aws lambda create-alias --function-name p84-js --name live --function-version 1   -> ok
$ aws lambda create-alias (the same name again)   -> ResourceConflictException "Alias already exists: arn:aws:lambda:us-east-1:000000000000:function:p84-js:live"
$ aws lambda create-alias --name bad --function-version 99   -> ResourceNotFoundException "Function not found: ...:p84-js:99"
$ aws lambda list-aliases / get-alias / update-alias --description changed / delete-alias   -> ok
$ aws lambda invoke --function-name p84-js --qualifier live   -> StatusCode 200
$ aws lambda delete-function --function-name p84-js --qualifier 1   -> ok
$ aws lambda put-provisioned-concurrency-config --qualifier 1 / list-provisioned-concurrency-configs / delete-provisioned-concurrency-config   -> answered, none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and the function's page.
3. Choose the tab "Versions", then "Aliases".
4. Each page says there is no screen yet.

## Expected
- A function's versions and aliases are listed; a version can be published and deleted; an alias can be created, edited and deleted; the emulator's answer, a refusal included, is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Weighted aliases unless the requirement finds the emulator keeps the weights. Provisioned concurrency unless the requirement takes it up. Any engine change. Anything sent to real AWS.
