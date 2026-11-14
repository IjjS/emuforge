# EmuForge

A local workbench on top of the official [aws-emulator](https://github.com/aws/aws-emulator): a web console
(Studio), a CLI, IAM policy evaluation and IaC verification. EmuForge does not reimplement the emulator; it
calls one that is already running. It is not an AWS project.

## Layout

| Path | Contents |
| --- | --- |
| `studio/` | Web console frontend (React, TypeScript, Vite, Cloudscape, bun). Has its own unit tests |
| `engine/` | Engine server, CLI, IAM and Verify modules (Rust, Cargo workspace). Has its own unit tests |
| `tests/integration/` | Integration tests that run against a real emulator |
| `infra/aws-emulator/` | Emulator Docker image, Compose file and shell environment script |
| `issues/` | Work items as files; see [issues/README.md](issues/README.md) |

## Run the emulator

```bash
docker compose -f infra/aws-emulator/docker-compose.yml up -d --build
source infra/aws-emulator/env.sh      # point this shell's AWS CLI and SDKs at the emulator
aws sts get-caller-identity           # Account 000000000000 means you reached the emulator
EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml up -d   # a second emulator beside it
EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml down    # stops only that one
docker compose -f infra/aws-emulator/docker-compose.yml down
```

## License

[Apache-2.0](LICENSE)
