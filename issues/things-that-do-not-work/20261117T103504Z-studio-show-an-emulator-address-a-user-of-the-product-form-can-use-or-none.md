Issue-Id: 441
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|emulator-line|address-inside-the-form
Issue-Check-Ids:
Issue-Commit: 495a18d65a3867f96c384dbb7ccb13d386c0b3a6

# Show an emulator address a user of the product form can use, or none

> Identified against commit `495a18d65a3867f96c384dbb7ccb13d386c0b3a6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's emulator line shows the address the engine reports for the emulator: "Connected at
https://127.0.0.1:9297", or "Not answering at https://127.0.0.1:9297"
(`studio/src/providers/aws/area/components/emulator-line.tsx`, the `endpoint` of the engine's health answer).
For the developer's start that is an address on the user's machine. In the product form as issue 437 makes it
(the form includes its own emulator, whose port is not published on the host), it is an address inside the
form: nothing answers there on the user's machine, or an unrelated emulator the user runs does. The reference is
Studio's own stated behavior: the line tells the user where the emulator they are connected to is.

This becomes visible once issue 437 is merged; until then the product form connects to an emulator on the host
and the address is right.

## Evidence

The engine's health answer in the form of issue 437, from that issue's probe on 2026-11-17 (the emulator a
service of the form, its port not published; the only published ports are Studio's and the engine's):

```
$ curl -s http://127.0.0.1:8497/__emuforge/health
{"emulator":{"port":9297,"endpoint":"https://127.0.0.1:9297","reachable":true}}
```

```
$ grep -n endpoint studio/src/providers/aws/area/components/emulator-line.tsx
55:      return { type: 'success', before: 'Connected at ', value: result.emulator.endpoint, recovery: false };
59:        : { type: 'error', before: 'Not answering at ', value: result.emulator.endpoint, recovery: true };
```

## Steps to Reproduce

1. With issue 437 merged, at the root of a clone: `docker compose up -d --build`.
2. Open `http://127.0.0.1:8296/` and read the emulator line.
3. It names `https://127.0.0.1:9297`; on the host, `curl https://127.0.0.1:9297/` is refused (or reaches another
   emulator the user runs).

## Expected

- In the product form the emulator line names nothing a user cannot reach from their machine: it says the
  emulator is the one EmuForge started, or names no address.
- For the developer's start the line is as today.
- How Studio learns which of the two it is in is decided by the fix (the engine's health answer may have to say
  it, which is then an engine part of its own).

## Out of scope

- Publishing the emulator's port.
- The recovery text of the same line (issue 442 covers the engine's advice).
