Issue-Id: 385
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|dashboard
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS "Dashboard" screen

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation entry "Dashboard" (capture `02-dashboard`) shows the counts of the account's SNS resources; Studio has no screen for it, and `/aws/sns` opens the topic list (issue 78). Each count comes from a list the emulator answers.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns list-topics   -> 200, 100 a page
$ aws sns list-subscriptions   -> 200, 100 a page
$ aws sns list-platform-applications   -> 200, empty
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/sns/dashboard`.
3. The page says there is no screen yet.

## Expected
- The dashboard shows what the capture's dashboard shows and the emulator holds, each number read from the emulator within the rule against loading every page (a count beyond one page is shown as "100+"), each a link to its list.
- Whether `/aws/sns` then opens the dashboard or stays the topic list is decided with the `pm`.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The console's landing pages (marketing pages with no resource of the emulator's). Any engine change. Anything sent to real AWS.
