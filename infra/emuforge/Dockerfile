# The product form's image (issue 34): the engine, Studio's built files with its own server, and HAProxy as the TCP
# gateway between the form's network namespace and the host. Built by the root docker-compose.yml with the
# repository root as its context, cut down by Dockerfile.dockerignore to engine/ and studio/ without what a host
# build writes, and with this directory as the second context `gateway`, of which only haproxy.cfg is copied. The
# three services of the Compose file run this one image with three commands.
#
# Every base image has an exact tag: the Rust and bun versions equal the toolchains pm-check uses.

FROM rust:1.100.0-slim-bookworm AS engine
WORKDIR /src/engine
COPY engine/ ./
RUN cargo build --release --locked --bin emuforge-server

FROM oven/bun:1.4.4-debian AS studio
WORKDIR /src/studio
COPY studio/ ./
RUN bun install --frozen-lockfile && bun run build

FROM debian:bookworm-20261104-slim
# HAProxy from Debian; its version that day is printed into the build log.
RUN apt-get update \
    && apt-get install -y --no-install-recommends haproxy \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && haproxy -v \
    && mkdir -p /home/emuforge \
    && chown 1000:1000 /home/emuforge
COPY --from=engine /src/engine/target/release/emuforge-server /usr/local/bin/emuforge-server
COPY --from=studio /usr/local/bin/bun /usr/local/bin/bun
# serve.ts resolves dist/ and src/app/serve-config.ts from its own place, so they keep their relative places.
COPY --from=studio /src/studio/dist /opt/emuforge/studio/dist
COPY --from=studio /src/studio/package.json /opt/emuforge/studio/package.json
COPY --from=studio /src/studio/scripts/serve.ts /opt/emuforge/studio/scripts/serve.ts
COPY --from=studio /src/studio/src/app/serve-config.ts /opt/emuforge/studio/src/app/serve-config.ts
COPY --from=gateway haproxy.cfg /opt/emuforge/haproxy.cfg
USER 1000:1000
ENV HOME=/home/emuforge
WORKDIR /home/emuforge
