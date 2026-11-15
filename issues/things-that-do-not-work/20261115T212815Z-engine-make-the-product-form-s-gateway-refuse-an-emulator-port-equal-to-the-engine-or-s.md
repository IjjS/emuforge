Issue-Id: 39
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|product-form|equal-ports-gateway-loop
Issue-Check-Ids:
Issue-Commit: 1d0144bf9822cea3d4f611052b841c394c8653ce

# Make the product form's gateway refuse an emulator port equal to the engine or Studio port

> Identified against commit `1d0144bf9822cea3d4f611052b841c394c8653ce`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In the product form (issue #34), when `EMULATOR_PORT` is given the same value as `EMUFORGE_ENGINE_PORT` or
`EMUFORGE_STUDIO_PORT` in situation 3, the engine exits at its own validation (or Studio's server cannot bind),
but the gateway keeps running and its outgoing listener holds that port inside the containers' namespace. A
connection to the published port then travels gateway, the gateway's own listener, the host's publish of the
same port, and back, each hop a new connection held for up to the gateway's one-hour timeout, until its 1024
connections are used up. Studio's page polls health, so the loop starts by itself. Found by `rev` in the
review of issue #34's `e1` (P2: bounded, and only on a wrong configuration).

Reference: none; the product form is EmuForge's own.

## Evidence

- `infra/emuforge/haproxy.cfg:42-50`: the `emulator_out` frontend listens on `127.0.0.1:<EMULATOR_PORT>`
  whatever the other two ports are.
- Issue #34's check `engine.product-does-not-come-up-on-a-port-collision`, case 1: no health answer in 30 s
  while the gateway runs and has logged no line, which fits sessions that never end. The check passes because
  the form "does not come up"; it does not see the loop.
- `.pm/archive/34/` holds the design, whose failure table (section 5) does not describe this.

## Steps to Reproduce

1. `EMULATOR_PORT=8297 docker compose up -d --build` at the root of a clone (8297 is the engine's default port).
2. Open `http://127.0.0.1:8296/` or call the published engine port: nothing answers, the `gateway` container
   stays up, and its connection count climbs.

## Expected

- With an emulator port equal to the engine port or the Studio port, the gateway exits at start with one line
  that names the port, so nothing listens and nothing loops; `docker compose logs` shows the line.
- The README's Ports part says what happens.
- A check starts the form with each of the two equal-port mistakes and finds no running gateway and the line.

## Out of scope

- Other wrong configurations already covered by issue #34's failure checks.
