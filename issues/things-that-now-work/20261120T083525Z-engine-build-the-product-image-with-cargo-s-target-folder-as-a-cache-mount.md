Issue-Id: 594
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|product-image.build|cargo-target-as-cache-mount
Issue-Check-Ids: engine.product-build-runs-current-worktree-code
Issue-Commit: 77becf887508a37925676ffdd96a30c33f32d7e1

# Build the product image with cargo's target folder as a cache mount

> Identified against commit `77becf887508a37925676ffdd96a30c33f32d7e1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The build stage of `infra/emuforge/Dockerfile` runs
`cargo build --release --locked -p emuforge --features embed-studio --manifest-path engine/Cargo.toml` with cargo's
`target` folder inside the layer. Every build from a tree that differs (each check run, in every worktree) compiles
every crate from nothing and leaves a build cache record of 0.32 GB that is used once. On 2026-11-20 the machine held
78 such records, 24.88 GB, which Docker counts as shared and no bound removes (issue 593).

The owner chose the fix (2026-11-20): cargo's `target` folder becomes a BuildKit cache mount, so the layer holds the
binary alone and the compiled crates live in one mount that is written over. Proposed, not yet built or measured:

```dockerfile
# syntax=docker/dockerfile:1   (only if the file has no syntax line that allows --mount)
RUN --mount=type=cache,target=/src/engine/target,sharing=locked \
    cargo build --release --locked -p emuforge --features embed-studio --manifest-path engine/Cargo.toml \
    && cp engine/target/release/emuforge /emuforge
```

and the last stage copies `COPY --from=build /emuforge /usr/local/bin/emuforge` instead of the path under `target`,
since a cache mount is not part of the layer and `COPY --from=build /src/engine/target/...` would find nothing.

What the plan settles, by measuring on this machine:

- `sharing=locked` (one build at a time holds the mount; a second waits) against the default `shared` (cargo's own lock
  makes the second wait): which one, given that several worktrees' checks build at once, and what the wait costs.
- Worktrees with different sources share the one mount, so they void each other's workspace crates; the dependencies
  are kept while `Cargo.lock` is the same. Whether one mount is enough or the mount's `id` should differ (per
  `Cargo.lock`, for example).
- Cargo's registry and git folders (`/usr/local/cargo/registry`, `/usr/local/cargo/git`) as cache mounts too, so a
  build with no network change downloads nothing.
- The mount is a cache record of its own: how large it grows, that it is counted by the 20 GB bound (private), and
  that a build after it was pruned still passes (from nothing).
- GitHub Actions starts each run on a new machine: the mount is empty there and the build must pass as it does today.
- The same for the emulator image's Dockerfile and the integration run's own builds of the product image, when they
  build with cargo or build this file.

## Evidence

`.pm/run/evidence/buildx-du-verbose-20261120T1740.txt` (the 78 records of the step); `infra/emuforge/Dockerfile` lines 13 to 24 on `main` at `77becf887`; issue 593.

## Steps to Reproduce

Build the product image twice from trees that differ in one line of `engine/`, and read `docker buildx du --verbose`: a second record of the `cargo build` step of about 0.32 GB, and a second full compile.

## Expected

- A build of the product image from a tree that differs in a workspace crate compiles that crate and what depends on it, not the dependencies, when the mount holds an earlier build; the plan gives the measured times before and after.
- A build leaves no cache record of the size of a `target` folder: the record of the `cargo build` step holds the binary.
- The image is the same as today's in what it holds and how it runs (the binary, the user, the entry point); every check that builds it passes, on this machine and on GitHub Actions.
- Two builds at the same time both end with a working image.

## Out of scope

The bound of the build cache and when it is pruned (issue 593, harness). The worktrees' own `engine/target` folders on the host (about 1.3 GB each), which no Dockerfile builds.
