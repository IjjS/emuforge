# engine

What holds for every piece of work in `engine/`. The root `AGENTS.md` applies first. Stages, test criteria, the
security review and relay fidelity are in `references/` ("References" below).

## What the engine is

A local process that behaves as an AWS endpoint. It takes AWS API requests as they are, identifies the caller,
optionally evaluates IAM policy, re-signs with the emulator's keys and forwards to aws-emulator on loopback.
It never interprets a service's request or response body. A change that makes the engine understand one
particular AWS service is wrong by default and needs a decision recorded in the issue.

## Workspace

```
engine/
  Cargo.toml            workspace: members, [workspace.dependencies], [workspace.lints]
  crates/
    emuforge-core/      emulator connection, key and certificate loading, SigV4, relay
    emuforge-iam/       policy model and evaluation (pure, no I/O)
    emuforge-verify/    IaC tool adapters
    emuforge-server/    axum server (binary)
    emuforge-cli/       the `emuforge` binary (clap)
```

- Dependency direction: `core` depends on no other workspace crate. `iam` depends on nothing in the workspace.
  `verify` depends on `core`. `server` and `cli` depend on the libraries, never on each other.
- `iam` is pure: no network, no filesystem, no clock except one passed in. It is tested without a runtime.
- Create a crate only when an issue needs it. An empty crate is not scaffolding, it is noise.

## Baseline

- Stable Rust, edition 2024. `#![forbid(unsafe_code)]` in every crate.
- Readability, simplicity and maintainability come first. Prefer a plain function to a trait, a trait to a macro.
- Every dependency is declared once in `[workspace.dependencies]` with an exact version and used with
  `workspace = true`. A new dependency needs a line in the issue's `decisions.md`: what it is for and why the
  standard library or an existing dependency does not do it.
- TLS is rustls only. Never enable a native-tls or openssl feature.
- Lints are set in `[workspace.lints]` and inherited by every crate; never silence a lint with a crate-level
  `allow`. A local `#[allow(...)]` carries a one-line reason.

## Errors

- Library crates define their errors with `thiserror`, one enum per crate boundary. `anyhow` appears only in
  `main.rs` of the binaries.
- No `unwrap`, `expect`, `panic!`, `todo!` or `unreachable!` outside tests. The one exception is a value that
  is a compile-time constant (a literal regex, a static header name), written as `expect("<why it cannot fail>")`.
- An error message says what failed and what the user can do. It never contains a key, a signature, an
  `Authorization` header or a request body.
- An upstream error from the emulator is passed to the caller unchanged. The engine adds its own error only
  when the engine itself failed, and then in the error shape of the protocol the caller used.

## Async and I/O

- Tokio. Never block the runtime: file and process work that can take more than a moment goes through
  `tokio::fs`, `tokio::process` or `spawn_blocking`.
- Every outbound call has a timeout. Every loop that waits has a bound.
- Bodies are streamed, never collected, unless a size cap is checked first.
- Concurrency is bounded (a semaphore or a tower limit), never unbounded `spawn` per request.
- A dropped request future must leave nothing running: no detached task that outlives its request without an
  owner that cancels it.

## Secrets

- Emulator keys and session tokens are held in a type whose `Debug` and `Display` print `[redacted]`.
- They are read from `~/.aws/emulator/<port>/` at use, never copied to another file, never put in an
  environment variable of the engine's own process, never returned by any route.
- Logging uses `tracing` with structured fields. Never log headers wholesale, bodies, query strings of
  presigned URLs, or anything read from the emulator's credentials file.

## Tests

- Unit tests sit next to the code in `#[cfg(test)] mod tests`. Tests of a crate's public API sit in its `tests/`.
- A unit test uses no network, no Docker, no real time and no file outside a temp directory. A worker writes the
  unit tests its brief's scenarios ask. Anything that needs an emulator is an integration check, written by the
  plan, and lives in `/tests/integration`, not here.
- Name a test `<subject>_<condition>_<result>`, for example `resign_rejects_non_loopback_upstream`.
- One behavior per test. Cover several inputs for one behavior with a table of cases in one test, each case
  named so a failure says which one.
- Time is controlled with `tokio::time::pause`; a test never sleeps.
- Test what a caller can observe. Do not test private helpers through `pub(crate)` holes made for the test.
- Signing, header handling and policy evaluation are tested against fixed vectors kept under the crate's
  `tests/vectors/`; a vector is data from a named source (an AWS document, a captured request), never a value
  computed by the code under test.

## Checks

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

All three pass. They run in `pm-check`, which records them and keeps their logs under the worktree's
`output/logs/`.

## References

```
references/
  workflow.md          stages of an engine issue and what each produces (the plan)
  test-criteria.md     unit scenarios per unit and integration scenarios, coverage axes (the plan)
  security-review.md   the checklist every engine change is read against (every engine unit)
  relay-fidelity.md    what "the same as calling the emulator directly" means and how it is scored (every engine unit)
```

The plan reads every file; `pm-brief worker` names the last two in every engine unit's brief.
