# EmuForge

A local workbench on top of the official [aws-emulator](https://github.com/aws/aws-emulator): a web console
(Studio), a CLI, IAM policy evaluation and IaC verification. EmuForge does not reimplement the emulator; it
calls one that is already running.

## Independence and trademarks

EmuForge is an independent project. It is not affiliated with, endorsed by or sponsored by Amazon Web Services
(AWS).

Amazon Web Services, AWS and the names of AWS services are trademarks of Amazon.com, Inc. or its affiliates.

Studio's AWS area is built with the [Cloudscape Design System](https://cloudscape.design/), open source under the
Apache License 2.0, and is not a copy of the AWS console.

## Layout

| Path | Contents |
| --- | --- |
| `studio/` | Web console frontend (React, TypeScript, Vite, Cloudscape, bun). Has its own unit tests |
| `engine/` | Engine server, CLI, IAM and Verify modules (Rust, Cargo workspace). Has its own unit tests |
| `tests/integration/` | Integration tests that run against a real emulator |
| `infra/aws-emulator/` | Emulator Docker image, Compose file and shell environment script |
| `infra/emuforge/` | EmuForge's own image and its gateway configuration, run by the root `docker-compose.yml` |
| `issues/` | Work items as files; see [issues/README.md](issues/README.md) |

## Start

What it needs: Docker with Compose, nothing else on the host. The engine and Studio are built inside an image
build, so no Rust or bun toolchain is used. It was verified on Docker Desktop for macOS (Docker Engine 29.4.3,
Compose 5.1.4); Docker Engine on Linux without Docker Desktop reaches an emulator on the host differently and is
not supported yet. EmuForge is reached from the same machine only: every port is published on `127.0.0.1`.

Each start command builds before it runs (`--build`). A first build downloads base images, locked crates and
packages; a later one may still ask the base images' registries whether their tags moved. Once started, nothing
of EmuForge sends a request anywhere but to the emulator.

There are six ways to start, by situation. Two of them work today.

### 1. A released version, with an emulator already running

Not available yet. A released version installed with a shell command, which uses the emulator you already run.

### 2. A released version, without an emulator

Not available yet. A released version installed with a shell command, which also starts an emulator.

### 3. From a clone, with an emulator already running

At the root of a clone, with an emulator answering on `EMULATOR_PORT` (9297 unless you set it; see
[Run the emulator](#run-the-emulator)):

```bash
docker compose up -d --build
docker compose down
```

The first line starts EmuForge, the second stops it and leaves the emulator running. Open
http://127.0.0.1:8296/ in a browser. Started before the emulator, EmuForge shows it as not connected and connects
once it answers; it reconnects by itself after the emulator restarts. To change the ports, see
[Ports](#ports).

### 4. From a clone, without an emulator

At the root of a clone, with nothing on `EMULATOR_PORT`:

```bash
docker compose --profile emulator up -d --build
docker compose --profile emulator down
```

The first line starts EmuForge and an emulator beside it, the second stops both. Open http://127.0.0.1:8296/ in a
browser. This form is stopped with its own command: the stop command of situation 3 leaves its emulator running.
The emulator writes its files to `~/.aws/emulator/<port>/` as in [Run the emulator](#run-the-emulator), so
`source infra/aws-emulator/env.sh` points a shell at it. The start fails when an emulator already runs on that
port; use situation 3 then. To change the ports, see [Ports](#ports).

### 5. The CLI, with an emulator already running

Not available yet. The emuforge CLI, downloaded on its own, which uses the emulator you already run.

### 6. The CLI, without an emulator

Not available yet. The emuforge CLI, downloaded on its own, which also starts an emulator.

### Ports

Three variables set the ports, given to the start command and the same values to the stop command:

| Variable | Default | Port of |
| --- | --- | --- |
| `EMULATOR_PORT` | 9297 | the emulator EmuForge connects to; in situation 4 the one it starts |
| `EMUFORGE_ENGINE_PORT` | 8297 | the engine, where Studio and any AWS client send requests |
| `EMUFORGE_STUDIO_PORT` | 8296 | Studio, the address you open |

```bash
EMULATOR_PORT=9298 EMUFORGE_ENGINE_PORT=8397 EMUFORGE_STUDIO_PORT=8396 docker compose up -d --build
EMULATOR_PORT=9298 EMUFORGE_ENGINE_PORT=8397 EMUFORGE_STUDIO_PORT=8396 docker compose down
```

Each Studio port is its own Compose project, so two EmuForge instances with different Studio and engine ports run
side by side, and may share one emulator. The three ports must differ from each other, and none of them may be
18296 or 18297, which EmuForge uses inside its own containers. When a port is wrong the engine's own message names
its flag: `--port` for `EMUFORGE_ENGINE_PORT`, `--emulator-port` for `EMULATOR_PORT` and `--studio-port` for
`EMUFORGE_STUDIO_PORT`; `docker compose logs` shows it.

## Develop

The developer's start builds and runs each part by hand, each in its own terminal, with an emulator already up
(see [Run the emulator](#run-the-emulator)). It needs the Rust toolchain and bun on the host.

```bash
cd engine && cargo run --bin emuforge-server
cd studio && bun install && bun run build && bun run serve
```

Then open http://127.0.0.1:8296/. The same three variables set the ports; the engine also takes them as flags,
and a flag wins over its variable:

| Variable | Default | Engine flag | Read by |
| --- | --- | --- | --- |
| `EMULATOR_PORT` | 9297 | `--emulator-port` | the engine |
| `EMUFORGE_ENGINE_PORT` | 8297 | `--port` | the engine and Studio's server |
| `EMUFORGE_STUDIO_PORT` | 8296 | `--studio-port` | the engine and Studio's server |

```bash
cd engine && cargo run --bin emuforge-server -- --port 8397 --emulator-port 9298 --studio-port 8396
cd studio && EMUFORGE_STUDIO_PORT=8396 EMUFORGE_ENGINE_PORT=8397 bun run serve
```

Each part has its own guide and unit tests: [engine/README.md](engine/README.md) and
[studio/README.md](studio/README.md). The checks that run against a real emulator are in `tests/integration/`
([tests/integration/README.md](tests/integration/README.md)).

[![main](https://github.com/IjjS/emuforge/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/IjjS/emuforge/actions/workflows/main.yml)

Every push of `main` is checked on GitHub Actions, on Ubuntu, by
[.github/workflows/main.yml](.github/workflows/main.yml): the engine, Studio and integration steps of `pm-check`,
each in its folder. What it does not run there is listed, each with its reason, in
[.github/not-run.json](.github/not-run.json).

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
