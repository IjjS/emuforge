Issue-Id: 354
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|dashboard-applications-search
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build the Lambda navigation's "Dashboard", "Applications" and "Search functions by name"

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's Lambda navigation has the entries "Dashboard" and "Applications" and the control "Search functions by name" (the owner's captures `docs/aws-console/lambda/01-lambda`, `02-applications`, `14-search-functions-by-name`); Studio's Lambda navigation (issue 84) has the one link "Event Functions". What the emulator holds for each was not probed while planning issue 84 beyond the account settings; this issue's requirement finds it out first.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda get-account-settings   -> ok, AccountLimit (ConcurrentExecutions 1000, CodeSizeZipped 52428800, ...) and AccountUsage (TotalCodeSize 0, FunctionCount 0 on a fresh emulator)
$ aws lambda list-functions --marker <any text>   -> ok, the names greater than the text in code point order (what a search by the start of a name can ask for)
Not called: anything for "Applications" (CloudFormation's and the serverless application repository's APIs).
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/lambda/dashboard`.
3. The page says there is no screen yet.

## Expected
- The requirement states, per entry, what the emulator holds by calling it; an entry with data of the emulator gets its screen (the dashboard: the account's limits and usage), and one without is recorded as left out with the calls that show it.
- "Search functions by name" finds functions by asking the emulator, within the rule against loading every page.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The counts and badges of the console's navigation. Links to AWS's documentation. Any engine change. Anything sent to real AWS.
