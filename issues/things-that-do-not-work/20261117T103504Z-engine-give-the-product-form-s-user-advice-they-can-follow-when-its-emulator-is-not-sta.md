Issue-Id: 442
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|health|not-started-advice-in-the-product-form
Issue-Check-Ids:
Issue-Commit: 495a18d65a3867f96c384dbb7ccb13d386c0b3a6

# Give the product form's user advice they can follow when its emulator is not started

> Identified against commit `495a18d65a3867f96c384dbb7ccb13d386c0b3a6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

When the emulator's files are missing, the engine's health answer and its 5xx say what the user can do:
"there are no emulator files for port 9297 (~/.aws/emulator/9297/); start the emulator on port 9297"
(`engine/crates/emuforge-core/src/health.rs`). For the developer's start that is right: the user starts an
emulator on the host. In the product form as issue 437 makes it (the form includes its own emulator, in its own
container, with its files in a Docker volume), the user has no `~/.aws/emulator/9297/` and cannot "start the
emulator on port 9297" on the host; what helps is starting the form's emulator container again. The engine's own
rule (`engine/AGENTS.md`, Errors) is that a message says what failed and what the user can do.

This becomes visible once issue 437 is merged.

## Evidence

From issue 437's probe on 2026-11-17, the form's emulator container removed while the form runs:

```
$ curl -s http://127.0.0.1:8497/__emuforge/health
{"emulator":{"port":9297,"endpoint":"https://127.0.0.1:9297","reachable":false,"reason":"not_started","message":"there are no emulator files for port 9297 (~/.aws/emulator/9297/); start the emulator on port 9297"}}
```

The sibling messages of the same file ("restart the emulator on port {port}") give the same advice.

## Steps to Reproduce

1. With issue 437 merged, at the root of a clone: `docker compose up -d --build`.
2. `docker compose stop aws-emulator`.
3. `curl -s http://127.0.0.1:8297/__emuforge/health`: the message tells the user to start an emulator on port
   9297 and names a folder of their home that does not exist.

## Expected

- In the product form, the message for an emulator that is not started, and its siblings, give advice the user
  can follow there (the form's own start line, or its emulator's logs), and name no folder of the user's home.
- For the developer's start the messages are as today.
- No key, path inside the volume beyond the port's folder, or file content is added to any message.

## Out of scope

- What Studio shows as the emulator's address (issue 441).
- Changing the `reason` values.
