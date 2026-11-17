Issue-Id: 355
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|web-functions-microvms-connectors
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Find out whether the emulator knows Lambda's "Web Functions", "Replicas", "MicroVMs" and "Network connectors", and build the screens of those it holds

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's Lambda navigation has "Web Functions", "Replicas" (under "Event Function resources"), "MicroVM Images" and "MicroVMs" (under "MicroVMs") and "Network connectors" (the owner's captures `docs/aws-console/lambda/04-web-functions`, `09-replicas`, `10-microvm-images`, `11-microvms`, `12-network-connectors`); Studio has no screen for any of them. The AWS CLI used while planning issue 84 (2.34.53) has no operation of `aws lambda` for them, so nothing was called; this issue's requirement finds the operations (from the captures' requests or a newer SDK) and calls them.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda help (AWS CLI 2.34.53)   -> no operation for web functions, replicas, MicroVMs, MicroVM images or network connectors
$ aws lambda list-functions   -> ok; an item has no member that tells a web function from an event function
$ aws lambda list-capacity-providers / list-code-signing-configs / list-event-source-mappings / list-layers   -> ok (the other entries of "Event Function resources" answer)
Not called: any operation of the five groups.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/lambda/web-functions`.
3. The page says there is no screen yet.

## Expected
- The requirement names, per group, the operations and what the emulator answers to each, by calling it; a group the emulator holds gets its screens, and a group answered 501 or unknown is recorded as left out with the calls that show it, with no screen.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Event functions (issue 84). Any engine change. Anything sent to real AWS.
