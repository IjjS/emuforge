Issue-Id: 503
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|studio|reach-studio-from-an-allowed-host-through-one-port
Issue-Check-Ids:
Issue-Commit: 3430466d1aa1b043865b4bfcc5c5d8900df86cca

# Let a browser on an allowed host name reach Studio and the engine through Studio's one port

> Identified against commit `3430466d1aa1b043865b4bfcc5c5d8900df86cca`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19, opening Studio from another device through Tailscale (`tailscale serve` of
`https://<machine>.<tailnet>.ts.net:8296` to `http://127.0.0.1:8296`): Studio refused the request (it accepts only a
loopback Host and Origin), and even past that the page would fail, since the browser sends every engine and AWS
request straight to `http://127.0.0.1:8297`, which on the other device is that device's own loopback.

Wanted, as the `pm` proposed and the owner accepted ("그것도 추가해서 해"):
1. **One port for the browser.** The browser reaches the engine through Studio's own origin: the `emuforge`
   binary's Studio server takes the engine's routes under one path of Studio's port and hands them to the engine in
   the same process. Studio's client calls that path instead of `http://127.0.0.1:<engine port>`. The engine's port
   stays, on loopback, for AWS clients on the host (the AWS CLI, SDKs, IaC tools) and is never served to the tailnet.
2. **Allowed host names, set at start only.** `emuforge serve --allow-host <name>` (repeatable; an environment
   variable for Compose, `config` later for the CLI) adds names whose Host and Origin Studio accepts beside loopback.
   Without it, today's rule stands: loopback only. Nothing in Studio's UI can change the list (a browser it lets in
   could otherwise add itself); Studio may show it read-only.
3. Unchanged: the engine's relay re-signs AWS requests with the emulator's keys and reaches the emulator on loopback
   only; no key reaches the browser; the session token stays in memory; Studio and the engine bind loopback (a
   `tailscale serve` forwards to loopback).

What the requirement has to settle: the path and how the session, CORS and the browser guard read when the engine is
reached through Studio's origin; how a name is matched (exact, with or without port; `https` behind a proxy that
terminates TLS); what Studio shows; the checks that today pin the engine's origin rule.

## Evidence

The owner's attempt through the tailnet, 2026-11-19; `studio/src/lib/engine` and the browser guard of `engine/crates/emuforge-server/src/browser.rs` at `3430466`.

## Steps to Reproduce

`tailscale serve --https=8296 http://127.0.0.1:8296`, then open the tailnet URL from another device.

## Expected

With `--allow-host <tailnet name>`, Studio works from another device on the tailnet through port 8296 alone; without it, nothing changes.

## Out of scope
