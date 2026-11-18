# EmuForge

A local workbench on top of the official [aws-emulator](https://github.com/aws/aws-emulator): a web console
(Studio), a CLI, IAM policy evaluation and IaC verification. EmuForge does not reimplement the emulator; it
calls one it does not write: the one it starts beside itself, or, in the developer's start, one you run.

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
| `infra/emuforge/` | EmuForge's own image, the one binary `emuforge` with Studio built in, run by the root `docker-compose.yml` |
| `issues/` | Work items as files; see [issues/README.md](issues/README.md) |

## Start

From a clone, one line starts EmuForge and one stops it, the same on every platform and in every shell:

```bash
docker compose up -d --build
docker compose down
```

Then open http://127.0.0.1:8296/ in a browser.

The start line brings up two containers: `emuforge`, one process that serves Studio and the engine, and an
emulator of EmuForge's own, which it starts beside it. It returns once both containers are started; the emulator
may still be starting then, and Studio shows whether it is connected. When the emulator exits or does not come
up, the start line does not say so: Studio shows the emulator not connected, `docker compose ps -a` shows the
emulator's container not running or not healthy, and `docker compose logs aws-emulator` shows why.

What it needs: Docker with Compose, nothing else on the host: no bash, and no Rust or bun toolchain, because the
binary `emuforge`, with Studio in it, is built inside an image build. It was run on Docker Desktop for macOS (Docker Engine 29.4.3,
Compose 5.1.4) and on Docker Engine on Linux (Ubuntu, the runner of the checks of `main`). On Windows it was not
run yet.

Nothing of EmuForge is on the host. The emulator's files, its keys among them, are in a Docker volume of the form,
which only the emulator and `emuforge` mount (`emuforge` read-only), and the emulator's port is not published.
The stop line leaves the volume, which then holds no key; `docker compose down -v` removes it too.

An AWS client on the host uses the engine: endpoint http://127.0.0.1:8297 and any access key and secret. The
engine signs each request again with the emulator's own key, which a client does not need and which is not
available on the host. This is how requests reach the emulator, not access control: a client that reaches the
engine's port is answered as the emulator's caller.

The start line builds before it runs (`--build`). A first build downloads base images, the emulator's package,
locked crates and packages; a later one may still ask the base images' registries whether their tags moved. Once
started, nothing of EmuForge sends a request anywhere but to the emulator. Typed a second time while EmuForge
runs, the start line can recreate its containers, the emulator too, so EmuForge starts afresh and what the
emulator held is gone: each build gets a new image id from its provenance attestation. This line builds without
it and keeps the running containers (for PowerShell, see [Ports](#ports)):

```bash
BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose up -d --build
```

An emulator you already run, on any port, is neither used nor touched by EmuForge: using one that is already
running is not part of this form for now. A form started from a clone before this change, which could use such
an emulator or start one under its own name, leaves that emulator running as an orphan after you update the
clone; the stop line with `--remove-orphans` added removes it.

The other ways to get EmuForge are not available yet: a released version, installed with a shell command; and
the emuforge CLI, downloaded on its own.

### Ports

Three variables set the ports, given to the start command and the same values to the stop command:

| Variable | Default | Port of |
| --- | --- | --- |
| `EMUFORGE_STUDIO_PORT` | 8296 | Studio, the address you open |
| `EMUFORGE_ENGINE_PORT` | 8297 | the engine, where Studio and any AWS client send requests |
| `EMULATOR_PORT` | 9297 | the emulator inside EmuForge; not published; set it only to free the number for one of the other two |

In bash:

```bash
EMUFORGE_ENGINE_PORT=8397 EMUFORGE_STUDIO_PORT=8396 docker compose up -d --build
EMUFORGE_ENGINE_PORT=8397 EMUFORGE_STUDIO_PORT=8396 docker compose down
```

In PowerShell, where a variable set so stays set for the rest of that window, the same two lines and the start
line that keeps the running containers:

```powershell
$env:EMUFORGE_ENGINE_PORT=8397; $env:EMUFORGE_STUDIO_PORT=8396; docker compose up -d --build
$env:EMUFORGE_ENGINE_PORT=8397; $env:EMUFORGE_STUDIO_PORT=8396; docker compose down
$env:BUILDX_NO_DEFAULT_ATTESTATIONS=1; docker compose up -d --build
```

Each Studio port is its own Compose project, with its own emulator and its own volume, so two EmuForge instances
with different Studio and engine ports run side by side. The three ports must differ from each other; no other
port is reserved. When a port is wrong the message of `emuforge` names its flag and its variable: `--port` for
`EMUFORGE_ENGINE_PORT`, `--emulator-port` for `EMULATOR_PORT` and `--studio-port` for `EMUFORGE_STUDIO_PORT`.

A start whose Studio or engine port is taken on the host, or whose two ports are equal, exits non-zero and names
the port. With `EMULATOR_PORT` equal to the engine's or Studio's port `emuforge` refuses to start and the
emulator is not started: the start exits non-zero, Docker's message names the `emuforge` container, and
`docker compose logs emuforge` shows the line that names both variables and the number.

## Develop

The developer's start builds and runs each part by hand, each in its own terminal, with an emulator already up
(see [Run the emulator](#run-the-emulator)). It needs the Rust toolchain and bun on the host. The binary
`emuforge` serves the engine only, and Studio's dev server serves Studio beside it:

```bash
cd engine && cargo run -p emuforge -- serve
cd studio && bun install && bun run build && bun run serve
```

Then open http://127.0.0.1:8296/. The same three variables set the ports; `emuforge serve` also takes them as
flags, and a flag wins over its variable:

| Variable | Default | `emuforge serve` flag | Read by |
| --- | --- | --- | --- |
| `EMULATOR_PORT` | 9297 | `--emulator-port` | the engine |
| `EMUFORGE_ENGINE_PORT` | 8297 | `--port` | the engine and Studio's server |
| `EMUFORGE_STUDIO_PORT` | 8296 | `--studio-port` | the engine and Studio's server |
| none | 127.0.0.1 | `--listen-address` | the engine and Studio's server in the binary; anything but 127.0.0.1 logs a warning, and only the form uses it, inside its container |

```bash
cd engine && cargo run -p emuforge -- serve --port 8397 --emulator-port 9298 --studio-port 8396
cd studio && EMUFORGE_STUDIO_PORT=8396 EMUFORGE_ENGINE_PORT=8397 bun run serve
```

The binary with Studio built in, as the form runs it, serves both from one process; Studio's build comes first:

```bash
cd studio && bun install && bun run build && cd ../engine && cargo run -p emuforge --features embed-studio -- serve
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

This is the emulator run by itself, for the developer's start and for an AWS CLI pointed straight at an
emulator; it was run on macOS and Linux.

```bash
mkdir -p ~/.aws/emulator              # the emulator's folder, made by you before the first start
docker compose -f infra/aws-emulator/docker-compose.yml up -d --build
source infra/aws-emulator/env.sh      # point this shell's AWS CLI and SDKs at the emulator
aws sts get-caller-identity           # Account 000000000000 means you reached the emulator
EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml up -d   # a second emulator beside it
EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml down    # stops only that one
docker compose -f infra/aws-emulator/docker-compose.yml down
```

On Docker Engine on Linux the emulator runs as the owner of `~/.aws/emulator`, so the files it writes there are
yours. A folder that Docker created itself, because it was missing at the first start, belongs to root, and the
emulator refuses it with a message that says how to fix it.

## License

[Apache-2.0](LICENSE)
