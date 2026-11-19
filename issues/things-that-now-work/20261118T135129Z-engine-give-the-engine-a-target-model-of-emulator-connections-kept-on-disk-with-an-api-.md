Issue-Id: 485
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|targets|emulator-target-model-and-api
Issue-Check-Ids: engine.targets-relay-follows-the-active-target engine.targets-health-follows-the-active-target-and-never-falls-back engine.targets-kept-across-restart engine.targets-test-checks-a-running-emulator engine.targets-test-follows-an-emulator-restart engine.targets-hold-no-key engine.checks-engines-keep-their-settings-in-the-run engine.product-targets-compose-holds-one-target
Issue-Commit: aa4c03efad86f9b110d88c61c26e552f651ddd90

# Give the engine a target model of emulator connections, kept on disk, with an API to add, list, use, test and remove them

> Identified against commit `aa4c03efad86f9b110d88c61c26e552f651ddd90`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's product plan of 2026-11-18 (BRD), kept verbatim in Korean at `.pm/product/brd-2026-11-18.md` in the main checkout (untracked; issue 483 brings it into the repository). Its sections 4 (Emulator Connections, Target Switching, Connection Status, Engine API), 5 C (the target
model: `provider`, `emulator`, `endpoint`, where the credentials are, TLS; shared by the CLI and Studio; EmuForge's
own settings are the source, the emulator's own files are found automatically only later) and 9 (loopback, no real
AWS credentials, TLS verified).

Today the engine serves one emulator, fixed at start: `--emulator-port`, reached at `https://127.0.0.1:<port>`, its
keys and `ca.pem` read from `~/.aws/emulator/<port>/` (`engine/crates/emuforge-server/src/config.rs`).

Wanted: a target model in the engine (`emuforge-core` or a crate of its own, as the CLI will use it too), kept in a
settings file (on the host for a native run, on a volume in Compose), and an API on the engine's port: add, list,
use (the active target), test (connection, TLS, credentials), info, remove (removes the entry, stops nothing). The
relay and the health route follow the active target. A target's endpoint is loopback only (the owner, 2026-11-17:
"루프백만 허용하게끔 막을 생각이야"); its credentials are a reference to the emulator's own files, never copied into
the settings, never sent to the browser. Compose starts with one target, its own emulator.

## Evidence

The plan's file; `config.rs`, `emuforge-core/src/emulator.rs`, `connect.rs` at `aa4c03e`.

## Steps to Reproduce

Start the engine: it knows one emulator, given by its port at start.

## Expected

The engine holds several targets, one active, kept across restarts; every request goes to the active one; a target that is not loopback is refused.

## Out of scope
