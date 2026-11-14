Issue-Id: 6
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: gap
Issue-Source: plan
Issue-Key: harness|emulator.compose|single-instance
Issue-Check-Ids: harness.compose-side-by-side
Issue-Commit: b6826962168941938001393417fa6f23f2acc5ce

# Let the Compose file run one emulator per port side by side

> Identified against commit `b6826962168941938001393417fa6f23f2acc5ce`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Every pane and every integration run must start its own emulator on its own port (`pane-mode.md`, Emulator).
The Compose file cannot do that while another emulator from it runs: it fixes `container_name:
emuforge-aws-emulator` and the project name `emuforge`, so a second `docker compose up` with another
`EMULATOR_PORT` replaces or collides with the first, which is usually the owner's emulator on 9297.

Reference behavior: two emulators on two ports side by side, each writing its own `~/.aws/emulator/<port>/`, as
`docker run` with a distinct container name does.

## Evidence

```
$ grep -nE '^name:|container_name' infra/aws-emulator/docker-compose.yml
4:name: emuforge
8:    container_name: emuforge-aws-emulator
$ docker ps --format '{{.Names}} {{.Ports}}'
emuforge-aws-emulator 127.0.0.1:9297->9297/tcp
```

The issue 1 plan pane had to start its probe emulator with `docker run --name i1-plan-emu -p 127.0.0.1:9391:9391
... aws-emulator -p 9391` on 2026-11-14 instead of the Compose file.

## Steps to Reproduce

1. Start the emulator on 9297 with the Compose file.
2. `EMULATOR_PORT=9391 docker compose -f infra/aws-emulator/docker-compose.yml up -d`.
3. The emulator on 9297 is replaced instead of a second one starting.

## Expected

- With an emulator from the Compose file running on one port, starting one on another port leaves the first
  running, and each answers `GET /__admin/health` with `200 ok` on its own port.
- Stopping one of them leaves the other running.

## Out of scope

- How the integration suite starts its emulators (issue 1 plans that).
