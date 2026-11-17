Issue-Id: 322
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|live-tail
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs Live Tail screen: "Start tailing"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Start tailing" on the log group list (issue 71) leads to `/aws/logs/live-tail`, which shows the area's "no screen yet" page. The emulator knows `StartLiveTail`; whether it streams events, and whether the engine relays an event stream answer, is not yet found.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
sweep with an empty body (probe-1-sweep.log):
400  StartLiveTail   InvalidParameterException 1 validation error detected: Value at 'logGroupIdentifiers' failed to satisfy constraint …
(not 501: the emulator knows the operation; it was not called with real arguments)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a log group.
2. Open `/aws/logs/log-groups` and choose "Start tailing".
3. The page says there is no screen yet.

## Expected
- The requirement first calls `StartLiveTail` with real arguments, directly and through the engine, and records what comes back; an engine gap it finds is filed for the engine, not worked around.
- If the emulator streams: a Live Tail screen that shows events of chosen log groups as they arrive and can be stopped. If it answers 501: the screen says "not implemented".
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Any engine change (filed separately if the requirement finds one is needed). Any engine change. Anything sent to real AWS.
