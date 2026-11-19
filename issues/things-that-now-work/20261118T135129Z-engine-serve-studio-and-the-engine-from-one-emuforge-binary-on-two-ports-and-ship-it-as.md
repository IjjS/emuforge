Issue-Id: 484
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|packaging|one-binary-serves-studio-and-engine
Issue-Check-Ids: engine.serve-without-studio-serves-the-engine-only engine.product-studio-answers-as-studios-server engine.product-binary-refuses-a-taken-studio-port-and-serves-nothing engine.product-image-holds-one-binary engine.product-start-connects-to-its-own-emulator engine.product-start-has-one-unpublished-emulator engine.product-start-says-when-the-emulator-did-not-come-up engine.product-connects-when-the-emulator-starts-later engine.product-reconnects-after-the-emulator-restarts engine.product-ports-are-published-on-loopback-only engine.product-holds-no-key-and-one-read-only-mount engine.product-does-not-come-up-on-a-port-collision engine.product-configuration-names-loopback-and-the-emulator-only engine.product-readme-gives-the-commands-the-checks-run
Issue-Commit: aa4c03efad86f9b110d88c61c26e552f651ddd90

# Serve Studio and the engine from one emuforge binary on two ports, and ship it as one image beside the emulator

> Identified against commit `aa4c03efad86f9b110d88c61c26e552f651ddd90`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's product plan of 2026-11-18 (BRD), kept verbatim in Korean at `.pm/product/brd-2026-11-18.md` in the main checkout (untracked; issue 483 brings it into the repository). Its sections 2, 4, 6 and "Dockerfile 수정 방향": Studio and the engine are one Rust process and one
Docker image, on two ports (Studio 8296, engine 8297); the image holds one binary `emuforge` with Studio's static
build embedded (a crate added to the engine's workspace, built with a feature `embed-studio`, for the image now and
the CLI's binary later); no Bun and no Node at run time. Compose: the EmuForge image and the emulator as a separate
container, joined by Compose's internal network, the engine reaching the emulator by its service name; host ports of
Studio and the engine from environment variables, bound to `127.0.0.1`; the emulator's port, when published,
bound to `127.0.0.1`.

Today (`main`): `infra/emuforge/Dockerfile` builds `emuforge-server`, copies Bun and Studio's `scripts/serve.ts`, and
installs HAProxy; `docker-compose.yml` runs `gateway` (HAProxy, the two published ports), `aws-emulator`, `engine`
and `studio`, the last three in `gateway`'s network namespace, so the engine reaches the emulator at
`127.0.0.1:9297` (issue 437). The engine's TLS handshake to the emulator uses the server name `127.0.0.1` and
trusts only the emulator's `ca.pem` (`engine/crates/emuforge-core/src/connect.rs`).

What the requirement has to settle: what the emulator's certificate is issued for, found by a probe that prints
neither key nor certificate (only whether a handshake for a given name verifies), and so whether the engine can
reach it by service name with verification kept (root `AGENTS.md`: never turn TLS verification off) or the emulator
keeps sharing the EmuForge container's network namespace; what in Studio's serving the binary takes over (the
`/engine.json` answer of `serve.ts`, the single-page fallback, the loopback binding, the origin the engine accepts);
how the confirmed checks of the product start (`engine.product-start-*`, `studio.serve-*`) change; and that the
binary stays the same one the CLI will be.

## Evidence

The plan's file; `infra/emuforge/Dockerfile`, `docker-compose.yml`, `studio/scripts/serve.ts` at `aa4c03e`.

## Steps to Reproduce

`docker compose up -d --build`; `docker compose ps`: four services, Bun and HAProxy in the image.

## Expected

`docker compose up -d --build` starts two containers (EmuForge, the emulator); Studio at `http://127.0.0.1:8296`, the engine at `http://127.0.0.1:8297`; one binary in the image; every product check passes.

## Out of scope
