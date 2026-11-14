Issue-Id: 1
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|workspace|missing
Issue-Check-Ids:
Issue-Commit: e55940995ba32d732a9dbc77a3796d54bd3a1ef7

# Create the engine workspace with emulator connection and a health endpoint

> Identified against commit `e55940995ba32d732a9dbc77a3796d54bd3a1ef7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`engine/` holds only guides. There is no Cargo workspace, no crate and no binary, so nothing can connect to the
emulator and no later engine issue has a place to land. The engine is the single path from Studio and the CLI to
the emulator; its first job is to find a running emulator, read that emulator's own keys and CA certificate, and
report whether the emulator is reachable.

Reference behavior: the same request sent straight to aws-emulator. `GET /__admin/health` over HTTPS, trusting
the emulator's `ca.pem`, answers `200` with body `ok`. The emulator writes new keys and a new CA under
`~/.aws/emulator/<port>/` on every start, so a restart invalidates whatever the engine read before.

This issue also brings the first integration check, and with it `tests/integration/run`, the entry point
`pm-check` calls.

## Evidence

```
$ ls engine
AGENTS.md  CLAUDE.md  README.md  references
$ .pm/bin/pm-check .
  engine             absent
  studio             absent
  integration        absent
PASSED commit=e55940995 failed=- nothing to run in this checkout
$ curl -s --cacert ~/.aws/emulator/9297/ca.pem -w '\nHTTP %{http_code}\n' https://127.0.0.1:9297/__admin/health
ok
HTTP 200
```

## Steps to Reproduce

1. Start the emulator: `docker compose -f infra/aws-emulator/docker-compose.yml up -d`.
2. `cd engine && cargo build`: fails, there is no `Cargo.toml`.
3. There is no engine process to ask whether the emulator is up.

## Expected

- `cargo fmt --check`, `cargo clippy` and `cargo test` run from `engine/` and pass; the workspace has the crates
  and the dependency direction `engine/AGENTS.md` names (crates with nothing to do yet may be empty).
- The engine server starts, binds to `127.0.0.1` only, and takes the emulator port as configuration.
- A health endpoint on the engine reports the emulator as reachable while the emulator runs, and as unreachable,
  without crashing or hanging, when it is stopped or was never started.
- After the emulator restarts with new keys and a new CA, the engine reports it reachable again without being
  restarted itself.
- No key, secret or certificate content appears in the engine's output, logs or HTTP responses.
- TLS verification stays on; the only trust anchor added is the emulator's `ca.pem`.
- `tests/integration/run` exists, `pm-check` reports the engine and integration steps as run, and the check ids
  are listed in this file's `Issue-Check-Ids` when it moves.

## Out of scope

- Relaying AWS API requests (issue #2).
- The CLI's `emuforge aws` command, IAM evaluation and Verify.
- Starting or stopping the emulator from the engine.
- Persistence of any kind.
