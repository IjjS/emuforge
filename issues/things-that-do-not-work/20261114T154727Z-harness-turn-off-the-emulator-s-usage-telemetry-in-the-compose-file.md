Issue-Id: 5
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|emulator.telemetry|on-by-default
Issue-Check-Ids:
Issue-Commit: b6826962168941938001393417fa6f23f2acc5ce

# Turn off the emulator's usage telemetry in the Compose file

> Identified against commit `b6826962168941938001393417fa6f23f2acc5ce`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`infra/aws-emulator/docker-compose.yml` starts the emulator with `-p <port>` only. The emulator's usage telemetry
is on by default, so every emulator this repository starts reports usage outside the machine. Root `AGENTS.md`
says nothing in this repository may send a request to real AWS, and `engine/references/security-review.md` T1
says EmuForge sends nothing anywhere.

Reference behavior: the emulator's own option. `aws-emulator --help` (v1.0.364) documents
`-t, --telemetry on|off` with "Default: on; off always wins over EMULATOR_TELEMETRY and the config file".

## Evidence

```
$ docker run --rm --entrypoint aws-emulator aws-emulator --help | grep -A1 telemetry
  -t, --telemetry on|off     Usage telemetry for this run. Default: on; off always wins over
                             EMULATOR_TELEMETRY and the config file, on cannot override them.
$ grep -n command infra/aws-emulator/docker-compose.yml
    command: ["-p", "${EMULATOR_PORT:-9297}"]
$ ls ~/.aws/emulator
9297  telemetry
```

Found by the issue 1 plan pane on 2026-11-14 against emulator v1.0.364 (commit 7496e0fe).

## Steps to Reproduce

1. `docker compose -f infra/aws-emulator/docker-compose.yml up -d --build`.
2. `docker inspect emuforge-aws-emulator --format '{{.Args}}'` shows no `-t off`.

## Expected

- Every emulator the repository starts (the Compose file and anything the harness or the integration suite starts)
  runs with telemetry off, and the started process's arguments show `-t off`.

## Out of scope

- Telemetry of tools other than the emulator.
