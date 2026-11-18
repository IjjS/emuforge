# engine

The lightweight local engine between Studio, the CLI and aws-emulator. It behaves as an AWS endpoint: it takes
AWS API requests as they are, checks the caller, and forwards them to the emulator.

Stack: Rust (Tokio, Axum), Cargo workspace.

Modules (iam and verify are planned):

| Module | Role |
| --- | --- |
| core | Emulator connection, key and certificate loading, re-signing and relay |
| server | Local HTTP server (library): the engine, Studio's server over the files it is given, and `serve` of both |
| emuforge | The `emuforge` binary: `emuforge serve` runs the engine and, when built with `embed-studio`, Studio |
| iam | Policy evaluation |
| verify | IaC tool adapters |

## Run

```
cargo run -p emuforge -- serve
```

serves the engine on `127.0.0.1:8297` against the emulator on port 9297; Studio is not served by this build.
`emuforge serve --help` lists the flags: `--port` (`EMUFORGE_ENGINE_PORT`), `--emulator-port` (`EMULATOR_PORT`),
`--studio-port` (`EMUFORGE_STUDIO_PORT`) and `--listen-address` (default `127.0.0.1`, no variable; anything else
is logged as a warning).

The binary with Studio embedded needs Studio's production build first:

```
(cd ../studio && bun install && bun run build)
cargo run -p emuforge --features embed-studio -- serve
```

A build with `embed-studio` and no `studio/dist/index.html` fails, naming that path.
