# EmuForge product plan

This is the owner's product plan of 2026-11-18: what EmuForge is, what it is made of, the order it is built in,
how it is delivered and what is out of scope for now. It is the owner's, given in Korean; this guide restates it in
English and quotes the owner's Korean where a sentence decides something. Every agent is pointed here for the
product's direction. A guide that says something else names the issue that brings it here ("Where the repository
stands", at the end).

## Overview

EmuForge is a developer tool on top of AWS's emulator. It manages local cloud resources visually, reaches the
emulator through a CLI, and later verifies IAM policies and IaC definitions.

> EmuForge는 AWS Emulator를 기반으로 로컬 클라우드 리소스를 시각적으로 관리하고, CLI를 통해 에뮬레이터에 접근하며, 향후 IAM 정책 및 IaC 구성을 검증할 수 있도록 지원하는 개발자 도구다.

Its line: "Your free, local cloud workspace".

Directions:

- **Local-first.** It works locally and depends on no outside service.
- **CLI and web UI.** An installed CLI and Studio in the browser.
- **Existing tools are used, not rebuilt.** The AWS CLI, the SDKs and Terraform are not reimplemented
  ("AWS CLI, SDK, Terraform 등을 재구현하지 않음").
- **The emulator at the centre.** EmuForge works with an emulator the user runs, or with the one in its Compose
  form ("사용자가 직접 실행한 에뮬레이터 또는 Compose에 포함된 에뮬레이터와 연동").
- **Room to extend.** Only AWS's emulator at first, designed so other providers can follow
  ("초기에는 AWS Emulator만 지원하며, 향후 다른 Provider로 확장 가능하도록 설계"). Studio's guide keeps the
  owner's earlier decision (2026-11-15) that names Google Cloud and Azure as the planned direction
  (`studio/PRODUCT.md`).
- **Security.** Local access by default; credentials are not exposed and outside traffic is kept to what is
  needed.

A developer makes resources with the AWS CLI or an SDK they already use, and looks at them in Studio or checks
them with EmuForge's verification.

## Parts and ports

| Part | What it is | Default port |
|---|---|---|
| Studio | the web UI | 8296 |
| CLI | the command interface | |
| Rust engine | REST API, connection management, later the verification engine | 8297 |
| AWS emulator | the real resources and their API; an outside dependency run on its own | 9297 |

Studio, the engine and the CLI are EmuForge; the emulator is not
("AWS Emulator는 별도로 실행되는 외부 의존성이다").

The CLI's AWS commands do not go through the engine: they go to the emulator through the installed AWS CLI
("Rust Engine을 경유하지 않고, 설치된 AWS CLI를 통해 Emulator에 직접 전달할 수 있다").

Studio and the engine are one process and one image, on two ports:

> Studio와 Engine은 하나의 Rust 프로세스 및 하나의 Docker 이미지로 묶을 수 있다. 포트는 기존 계획대로 두 개를 유지한다.

## Roadmap

1. **Studio** (in progress). A browser UI for the emulator: per service, list, create, edit and delete resources,
   and manage the emulator connections.
2. **CLI.** A natively installed executable: starts Studio and the engine, manages settings and targets, passes
   AWS CLI commands through.
3. **IAM simulator** (to be decided). A policy evaluation engine of its own that uses the emulator's IAM
   resources, with Studio and the CLI.
4. **IaC integration and verification** (to be decided). Terraform, CloudFormation and other IaC definitions
   compared with the emulator's real resources, with results in the CLI and Studio.

## Phase 1: Studio

| Area | Feature |
|---|---|
| Web console | a per-service UI familiar from AWS |
| Resource management | list, create, edit and delete the resources of the supported services |
| Emulator connections | register, choose and remove several emulators |
| Target switching | change the emulator Studio's screens read |
| Connection status | whether it is connected, the error, the endpoint |
| Engine API | the Rust backend behind Studio's features |
| Provider extension | an interface that keeps later providers in mind |

The AWS console's patterns of use are a reference; brand, icons and screen layout are EmuForge's own:

> AWS Console의 사용 패턴은 참고하되, 브랜드·아이콘·화면 구성은 EmuForge 고유 디자인을 사용한다.

Default ports: Studio 8296, engine API 8297, emulator 9297. Studio and the engine are one unit that keeps two
separate ports ("단일 실행 단위로 구성하되, 서로 다른 두 포트를 사용할 수 있도록 유지한다").

## Phase 2: the CLI, as planned

```
emuforge
├── version
├── status
├── config  (list | get | set)
├── studio  (up | down)
├── target  (add | list | use | test | info | remove)
└── aws <aws-cli-arguments...>
```

**Basic management.** `version` prints the CLI's version and build. `config list`, `config get <key>`,
`config set <key> <value>`. `status` shows Studio, the engine and the emulator, each with its real port and
address, and the active target. A service that does not answer is not shown as running, whatever state was kept:

> 실행 정보가 남아 있더라도 응답하지 않는 서비스는 Running으로 표시하지 않는다.

```
$ emuforge status

EmuForge v0.1.0

COMPONENT      STATUS       ADDRESS
Studio         Running      http://127.0.0.1:8296
Engine         Running      http://127.0.0.1:8297
AWS Emulator   Connected    https://127.0.0.1:9297

Active Target: local
```

**Running Studio.** `studio up` starts Studio and the engine together; `studio down` stops the Studio and engine
the CLI started. Options: `--ui-port 8296 --server-port 8297 --emulator-port 9297`.

- Ports are picked by pair: 8296/8297 by default; when either is taken, the next pair (8296/8297, then
  8298/8299, then 8300/8301).
- A port the user names is never moved: a conflict is an error
  ("사용자가 포트를 명시하면 충돌 시 자동 변경하지 않고 오류 반환").
- `--emulator-port` is the port of the emulator to connect to; it does not run an emulator.
- `studio down` never stops an emulator the user started.
- Picking ports applies to the native CLI only; Compose's host ports are set separately.

**Targets.** `target add` registers an emulator connection; `list`; `use` chooses the default target; `test`
checks the real connection, TLS and authentication; `info` shows the endpoint, provider and state; `remove`
deletes the connection's record and does not stop the emulator.

```
emuforge target add local --provider aws --emulator aws-emulator --endpoint https://127.0.0.1:9297
emuforge target test local
emuforge target use local
emuforge target list
```

A target holds the provider, the emulator, the endpoint, where its credentials are kept (a reference, not the
credentials) and its TLS settings. Decisions:

- EmuForge's own settings are the record of connections; finding the emulator's existing settings files by
  itself is a later convenience
  ("EmuForge 자체 설정을 연결 정보의 기준으로 사용하고, AWS Emulator의 기존 설정 파일 자동 탐지는 추후 편의 기능으로 취급한다").
- The CLI and Studio use one target model and one management logic
  ("CLI와 Studio는 동일한 Target 모델 및 관리 로직을 사용한다").
- Natively they share a settings file on the host; in Compose the engine manages settings kept on a persistent
  volume. The two deliveries are not assumed to sync
  ("두 배포 환경 사이에 설정이 자동 동기화된다고 가정하지 않는다").

**AWS CLI pass-through.** `emuforge aws s3 ls`, `emuforge aws iam list-roles` and so on call the installed AWS
CLI; EmuForge does not reimplement its commands. The flow: check the active target, apply its endpoint,
credentials and TLS settings, run the installed AWS CLI, reach the emulator. Arguments and output stay those of
the AWS CLI. Endpoint options and inherited AWS credentials are handled strictly, so that no request reaches real
AWS by mistake:

> 단, 실제 AWS로 잘못 요청이 전달되는 일을 막기 위해 Endpoint 변경 옵션과 상속된 AWS 자격 증명은 엄격하게 처리한다.

No `resource list`, `resource inspect`, `lab` or similar commands are made
("별도의 `resource list`, `resource inspect`, `lab` 등의 명령은 만들지 않는다").

## Delivery: two ways

**A. Native CLI.** An executable per operating system from GitHub Releases, which holds the Rust engine and
Studio's static files and runs them without Docker, beside an emulator the user installs and runs.

- Installing EmuForge needs no Docker; the user installs and runs the emulator.
- Installing or starting an emulator automatically is out of the first scope
  ("Emulator 자동 설치·실행 기능은 초기 범위에서 제외").
- Without an emulator, Studio and the engine still run and show that they are not connected.
- The user registers a target's endpoint and credentials directly.
- `emuforge aws` needs the AWS CLI installed.
- Executables per OS and management of what runs are to be built.

**B. Docker Compose.** The complete environment: EmuForge and the emulator together.

- One EmuForge image (Studio on 8296, the engine on 8297); the emulator in its own container (9297); the two on
  Compose's internal network. Started with `docker compose up -d --build`.
- Needs Docker and Docker Compose. The EmuForge image is published on Docker Hub or GHCR; the emulator is part
  of the Compose file and built when needed.
- The engine reaches the emulator by its Compose service name
  ("EmuForge Engine은 Compose 서비스 이름으로 Emulator에 접근").
- Connecting to an emulator outside, on the host, is not required of the default Compose form
  ("기본 Compose 배포에서는 외부 호스트 Emulator 연결 지원을 필수 범위에서 제외").
- Studio's and the engine's host ports are set by Compose's environment variables; they are never moved
  automatically.
- Target settings and the emulator's credentials they need are kept on a persistent volume or a limited mount.
- An emulator port published on the host binds to `127.0.0.1` only by default.
- No host-address translation such as `host.docker.internal` is needed in the default form, since the emulator
  is reached on the internal network.

## The two compared

| | Native CLI | Docker Compose |
|---|---|---|
| Studio | yes | yes |
| Rust engine | yes | yes |
| Emulator included | no | yes |
| Connecting to an existing emulator | yes | out of the default form's scope |
| Target management | CLI and Studio | mainly Studio |
| AWS CLI pass-through | in the CLI | with a CLI installed on the host |
| Studio port picked automatically | yes | no |
| Who installs the emulator | the user | the Compose file |
| Needs Docker | no | yes |
| Where settings persist | the host user's settings | a volume or mount |
| Where it is published | GitHub Releases | Docker Hub or GHCR |

## Release and versions

Versions follow Git tags, and the native CLI and the Docker image of one version are released together
("동일 버전의 Native CLI와 Docker 이미지를 함께 배포한다"). A tag such as `v0.1.0` starts GitHub Actions: build
and test, the CLI release (macOS, Windows, Linux), the Docker image (`emuforge:0.1.0`), and the Compose release
(`compose.yaml`, `.env.example`). The image holds Studio and the engine; the emulator is its own Compose service.
The CLI and the image carry the same tag; an explicit version is recommended over `latest`.

## Non-functional requirements

| Area | Requirement |
|---|---|
| Security | loopback binding by default; no unintended request to real AWS |
| Authentication | credentials for the emulator only; real AWS credentials are never read without permission |
| TLS | certificates stay verified; turning verification off is never the default way to connect |
| Settings | one target model for the CLI and Studio, persisted per delivery |
| Extensibility | providers and emulator implementations kept apart in the structure |
| Compatibility | macOS, Windows and Linux in mind |
| State | a taken port, a service's health check and a target's connection told apart |
| Delivery | pinned versions; update and rollback possible |
| Privacy | outside telemetry off by default |

## Out of scope for phases 1 and 2

The detailed features of the IAM simulator and of IaC verification; automatic labs and tutorials; a resource
listing CLI of EmuForge's own; installing the emulator automatically; connecting Docker containers to any
emulator on an outside host in general. Interfaces keep later extension in mind, but the scope is not grown ahead
of time:

> 향후 확장할 수 있도록 인터페이스는 고려하되 구현 범위를 미리 키우지 않는다.

## Direction

Studio, then the CLI, then IAM (to be decided), then IaC (to be decided). Two deliveries: the native CLI, the
flexible one that connects to an existing emulator, and Compose, the simple complete one with Studio, the engine
and the emulator together. Both reuse one Rust engine and one Studio; only how they run and connect differs:

> 공통적으로 하나의 Rust Engine과 Studio 구현을 재사용하며, 배포 방식에 따라 실행·연결 방법만 달라지도록 설계한다.

## The image

The owner's direction for the Dockerfile: one Rust binary, kept light, with no Bun in the image; Studio has no
Next.js, so it needs no Node at run time ("Rust의 싱글 바이너리 패키징으로 가볍게 유지하고 bun은 제외"). A crate
is added to the engine for the image and, later, the CLI's release binary. The owner's sketch:

```dockerfile
# 1. Build Studio as static files
FROM oven/bun:1.4.4-debian AS studio
WORKDIR /src/studio
COPY studio/ ./
RUN bun install --frozen-lockfile && bun run build

# 2. Embed that dist in the binary
FROM rust:1.100.0-slim-bookworm AS build
WORKDIR /src
COPY engine/ engine/
COPY --from=studio /src/studio/dist studio/dist
RUN cargo build --release --locked -p emuforge --features embed-studio \
      --manifest-path engine/Cargo.toml

# 3. Only the binary in the final image
FROM debian:bookworm-slim
COPY --from=build /src/engine/target/release/emuforge /usr/local/bin/emuforge
USER 1000:1000
ENTRYPOINT ["emuforge"]
```

The aim: a simple, flexible, light delivery that is easy to extend.

## Where the repository stands

What the repository does today differs from this plan in these places, each with the issue that changes it:

- **The image and the Compose form: issue 484.** One `emuforge` binary serves Studio and the engine on two ports,
  in one image. The emulator runs in its own container, joined to the `emuforge` container's network namespace,
  and the engine reaches it at `127.0.0.1` with `ca.pem` verified, not by its Compose service name: issue 484's
  probe found that the emulator's certificate names no Compose service. Root `AGENTS.md`'s sentence that the only
  upstream is the local emulator on loopback stays as it is.
- **Emulator connections: issues 485 and 486.** Today the engine knows one emulator, by its port. Issue 485 gives
  the engine the target model, kept on disk, with an API to add, list, use, test and remove targets; issue 486
  lets Studio register, choose, test and remove them and switch the target its screens read.
- **The release by Git tag: issue 35.**
- **Not filed yet:** the CLI of phase 2 and publishing the image on Docker Hub or GHCR.
