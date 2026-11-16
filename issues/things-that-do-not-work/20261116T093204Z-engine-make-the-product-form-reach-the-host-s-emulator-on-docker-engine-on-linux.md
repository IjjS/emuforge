Issue-Id: 54
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: plan
Issue-Key: engine|product-form|docker-engine-on-linux
Issue-Check-Ids:
Issue-Commit: f0bf02e915a04b2f17f1176275a3e00c75073aae

# Make the product form reach the host's emulator on Docker Engine on Linux

> Identified against commit `f0bf02e915a04b2f17f1176275a3e00c75073aae`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The product form (root `docker-compose.yml`, issue #34) reaches the host's emulator through the name
`host.docker.internal`: the gateway's backend is `host.docker.internal:${EMULATOR_PORT}`. Docker Desktop gives
every container that name. Docker Engine on Linux does not by itself, so on a Linux machine, and on the Ubuntu
runner that checks `main` (issue #53), the gateway has no address for the emulator and the engine in the form
never connects. Until this works, the workflow of issue #53 lists the sixteen `engine.product-*` checks in
`.github/not-run.json` and does not run them.

Reference: the product form's own stated behavior on macOS (README "Run EmuForge", the sixteen checks).

## Evidence

- `infra/emuforge/haproxy.cfg:59`: `server emulator "host.docker.internal:${EMULATOR_PORT}"`.
- `docker-compose.yml`: no service has `extra_hosts`; the name is not defined by the file.
- The emulator publishes its port on host `127.0.0.1` only (`infra/aws-emulator/docker-compose.yml`:
  `"127.0.0.1:${EMULATOR_PORT:-9297}:${EMULATOR_PORT:-9297}"`), so on Linux an address of the Docker bridge's
  gateway would not reach it either: the name alone is not the whole fix.
- All sixteen checks start a form through `tests/integration/studio/support/product.ts`; one,
  `engine.product-configuration-names-loopback-and-the-emulator-only`, asserts the name itself
  (`tests/integration/studio/product-files.spec.ts:210`).
- Not yet observed on a Linux machine: issue #53's first run on the runner does not run these checks. The
  unit that takes this issue reproduces it on Linux first.

## Steps to Reproduce

1. On a Linux machine with Docker Engine (not Docker Desktop), start an emulator:
   `docker compose -f infra/aws-emulator/docker-compose.yml up -d --build`.
2. `docker compose up -d --build` at the checkout's root.
3. Open `http://127.0.0.1:8296/`: Home's connection section does not report the emulator as reachable.

## Expected

- On Docker Engine on Linux the form started with either start command of the README connects to the emulator
  on `EMULATOR_PORT`, and the sixteen `engine.product-*` checks pass there.
- On Docker Desktop (macOS) the sixteen checks pass as today.
- Every port stays published on `127.0.0.1` only, the emulator's included; the form still holds no key and one
  read-only mount.
- The sixteen entries are removed from `checks` of `.github/not-run.json` by the unit that fixes this.

## Out of scope

- The emulator image's user on Linux (issue #55).
- Windows.
