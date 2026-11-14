# engine

The lightweight local engine between Studio, the CLI and aws-emulator. It behaves as an AWS endpoint: it takes
AWS API requests as they are, checks the caller, and forwards them to the emulator.

Stack: Rust (Tokio, Axum), Cargo workspace.

Planned modules:

| Module | Role |
| --- | --- |
| core | Emulator connection, key and certificate loading, re-signing and relay |
| server | Local HTTP server (binary) |
| iam | Policy evaluation |
| verify | IaC tool adapters |
| cli | The `emuforge` binary |
