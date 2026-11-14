Issue-Id: 3
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|app-shell|missing
Issue-Check-Ids:
Issue-Commit: e55940995ba32d732a9dbc77a3796d54bd3a1ef7

# Create the Studio app shell with a connection status screen

> Identified against commit `e55940995ba32d732a9dbc77a3796d54bd3a1ef7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/` holds only guides. There is no package, no build and no page, so no screen issue has a place to land.
Studio needs its application shell: the Cloudscape layout with service navigation, routing, the AWS SDK client
factory that talks only to the engine, and one EmuForge-only screen that shows whether the engine and the
emulator behind it are reachable.

The home and connection status screen exists only in EmuForge, so it is a `native` screen: the `plan` designs it
and the impeccable critique scores it (`studio/references/critique.md`). There is no AWS console screen to match
in this issue.

Depends on the engine's health endpoint (issue #1). It does not need the relay (issue #2) as long as no screen in
it calls an AWS API.

## Evidence

```
$ ls studio
AGENTS.md  CLAUDE.md  README.md  references
$ .pm/bin/pm-check .
  studio             absent
```

## Steps to Reproduce

1. `cd studio && bun install`: fails, there is no `package.json`.

## Expected

- `bun install`, the type check, the linter, `vitest` and the production build run from `studio/` and pass;
  `pm-check` reports the studio step as run.
- The built app opens on a home screen inside the Cloudscape app layout with a service navigation.
- The connection status shows the four states `studio/AGENTS.md` requires: loading, connected, engine
  unreachable, emulator unreachable; each is reachable in a test without a real outage.
- The app sends requests only to the engine on `127.0.0.1`; no emulator key or certificate is present in the
  bundle, in storage or in any response the browser receives.
- A route for a service with no screen yet says so plainly instead of showing an empty or broken page.
- The home screen passes the `native` line of `studio/references/critique.md`, with the score recorded by
  `pm-critique`.

## Out of scope

- Any service screen (S3, DynamoDB and the rest): each is its own issue.
- The structure score tool (issue #4); nothing here is a `console` screen.
- Identity switching and IAM screens.
- Verify screens.
