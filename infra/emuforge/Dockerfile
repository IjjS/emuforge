# The product form's image (issues 34, 437, 484): one binary, `emuforge`, with Studio's production build embedded.
# Built by the root docker-compose.yml with the repository root as its context, cut down by Dockerfile.dockerignore
# to engine/ and studio/ without what a host build writes. The final stage holds that one binary and Debian's slim
# base, whose bash the healthcheck of docker-compose.yml uses: no bun, no Node, no Studio source.
#
# Every base image has an exact tag: the Rust and bun versions equal the toolchains pm-check uses.

FROM oven/bun:1.4.4-debian AS studio
WORKDIR /src/studio
COPY studio/ ./
RUN bun install --frozen-lockfile && bun run build

FROM rust:1.100.0-slim-bookworm AS build
WORKDIR /src
COPY engine/ engine/
# build.rs of the crate emuforge embeds ../../../studio/dist, which is /src/studio/dist here.
COPY --from=studio /src/studio/dist studio/dist
RUN cargo build --release --locked -p emuforge --features embed-studio --manifest-path engine/Cargo.toml

FROM debian:bookworm-20261104-slim
# The settings folder of the Compose form, owned by the engine's user, so a new named volume mounted there takes
# that owner and the engine can write targets.json.
RUN mkdir -p /home/emuforge/.config/emuforge-compose && chown -R 1000:1000 /home/emuforge
COPY --from=build /src/engine/target/release/emuforge /usr/local/bin/emuforge
USER 1000:1000
ENV HOME=/home/emuforge
WORKDIR /home/emuforge
ENTRYPOINT ["emuforge"]
