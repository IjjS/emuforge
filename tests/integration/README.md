# tests/integration

Checks that start a real aws-emulator container and verify the `engine -> aws-emulator` path and the core
Studio flows. Unlike the unit tests in `studio/` and `engine/`, these need Docker.

## Studio stage

`run` builds Studio after the engine (`bun install --frozen-lockfile` and `bun run build` in `studio/`, one log at
`output/logs/integration-studio-build.log`) and, after the engine checks, runs the Playwright flow checks of
`studio/` one at a time with Studio's own pinned Playwright:

```
NODE_PATH=<checkout>/studio/node_modules \
  studio/node_modules/.bin/playwright test --config tests/integration/studio/playwright.config.ts
```

There is no second package and no second `bun.lock`. Each check is one `test()` titled with its check id; it starts
what it needs through `studio/support/` (Studio's server with `bun run serve`, the engine with `--studio-port` set
to Studio's port, the run's emulator or one of its own), stops it all when it ends, and writes its verdict file and
its log `output/integration/logs/<check id>.log` like an engine check. The browser is headless Chromium. Its proxy
is a loopback listener the check owns: a request to anything but a loopback address reaches it and is refused and
logged, while loopback addresses go direct. No request interception is installed, so a CORS preflight reaches its
server. The run's output is `output/logs/integration-playwright.log`.

When `studio/package.json` is missing, its install fails or its build fails, every Studio check fails at its first
step, as the engine checks do without an engine. Studio's port is `EMUFORGE_STUDIO_PORT` when set, else a free
loopback port.

## Product stage

`run` also builds the product form of issues 34 and 437: the images of the root `docker-compose.yml`, once per run,
with `docker compose --progress plain build` at the checkout's root under the run's own names (`EMUFORGE_IMAGE` set
to `emuforge-it-product-<run id>`, `EMUFORGE_EMULATOR_IMAGE` to `emuforge-it-emulator-<run id>`, which `run` first
tags from the run's pinned emulator image; log `output/logs/integration-product-build.log`). The checks never use the
names `emuforge` or `aws-emulator` and never port 9297. Each form writes its Compose project to
`output/integration/tmp/product-projects`; when it ends, `run` removes, of those projects, the containers created
under one of the run's two image names, the networks no container uses any more and the volumes the removed
containers mounted, logs each removal, then removes both names (`docker image rm`, which only untags an image that
has another name). The build has a bound of 600 seconds (`product_build_bound`): a build that has not ended by then,
such as one that waits for a registry that does not answer, is ended with its whole process group (SIGTERM, SIGKILL
10 seconds later) and is the environment's failure, so every check is `error` with the reason
`the product image build did not end within 600 s, see <log>` and the run exits 127 before it starts its emulator.

The product checks (`studio/product-*.spec.ts`, ids `engine.product-…`) start a form each through
`studio/support/product.ts`, which holds the command lines of the one form: the start line, the stop line, the line
that shows the emulator's log, the line that removes the volume too and the start line that keeps the running
containers (the README check compares the README's "Start" with them). A form runs at the checkout's root on free
ports of its own, with an emulator of its own whose files are in the form's Docker volume, and with an environment of
exactly `HOME` (the run's, another folder or none), the three ports, the two image names and a `PATH` on which
`cargo`, `rustc`, `bun` and `node` are not found (the Docker client's own `DOCKER_CONFIG`, `DOCKER_HOST` and
`DOCKER_CONTEXT` are passed on when set). Its containers, networks and volumes are those that carry its Compose
project's label, `emuforge-app-<studio port>`. Each check stops its form, removes its volume and removes whatever is
left, whatever its verdict. Two Compose files of the checks' own, never part of the shipped form, are given beside
the root file where a check needs them: `studio/support/product-direct.yml` publishes the form's emulator on a
loopback port of the run, so a check can send the same request directly, and `studio/support/product-deaf.yml`
starts the emulator on another port than its healthcheck asks.

When `docker-compose.yml` is missing or an image does not build, every product check still runs and fails at its
start line, as the engine checks do without an engine.

## A service's folder

A service's check support is in `studio/services/<service>/`: its helpers, the seed script of its structure score and
`studio/services/<service>/manifest.jsonl`, the rows of its checks. Its check files stay directly under `studio/`.
The seed script is not a check; the `pm` starts it from the repository root as
`NODE_PATH=studio/node_modules bun tests/integration/studio/services/<service>/<service>-seed-structure.ts …`.
Support that more than one service's checks, or a check of no service, read is shared and stays in `studio/support/`.

The manifest is `manifest.jsonl`, the rows of every check of no service in its order, then each service's
`manifest.jsonl`, the services in name order; a folder under `studio/services/` whose name is not a service name, or
that holds no `manifest.jsonl`, adds no row. Before anything else `run` writes it as
`output/integration/manifest.jsonl`, which its later steps read; when a part cannot be read it writes no such file
and the run meets it as a main manifest that cannot be read. In a checkout that holds `studio/services/`, `run` then
refuses to start, with every check `error` (exit 127) and one reason naming the first finding and their number:

- a row of `manifest.jsonl` that has a `service`;
- a row of a service's `manifest.jsonl` whose `service` is not that service, whose `module` is not `studio` or whose
  `path` is not a `.spec.ts` directly under `studio/`;
- a check id held by two rows;
- a `.ts` file under `studio/` that imports a file of `studio/services/<service>/` and is neither in that folder nor a
  check file of that service (a file every one of whose rows, at least one, has that `service`);
- any import of a `.spec.ts` file.

An import is a relative specifier of `from '…'`, `import '…'`, `import('…')` or `require('…')`, read as text and
never run, so a comment that reads like one counts; symbolic links are not followed and `node_modules` is left out.

## Checks not run

`run` takes `--not-run <file>`, `--on-request` and `--services <file>`, each at most once, in any order; with any other
argument, or an option without its file, it prints the usage line
`usage: tests/integration/run [--not-run <file>] [--on-request] [--services <file>]` and exits 2. Without
`--on-request` it runs every check that is not labelled `on-request` in the manifest, and reports each labelled one
`not-run` with the message `on request: not part of a default run; run it with --on-request`. With `--on-request`
those run like every other check.

`run --not-run <file>` leaves out the checks a not-run list names; the workflow on GitHub Actions passes it
`.github/not-run.json`. Only the list's `checks` are read: each entry's `id` must be a manifest id, listed once,
with a non-empty `reason`. A list that cannot be read or breaks one of these makes every check `error` (exit 127)
before anything is built or started. A check that is both listed and labelled `on-request` is `not-run` with the
list's reason, with or without `--on-request`.

`run --services <file>` leaves out the checks of the services a change does not touch. A check of a service is a
manifest row whose `service` is a service name (`[a-z][a-z0-9]*(-[a-z0-9]+)*`, the name of its folder under
`studio/src/providers/aws/area/services/`); a row without the field, or with any other value, is a check of no
service and is part of every run. The file is JSON `{"services": [<service name>, …]}` or `{"services": null}`; its
other keys are not read. `null` is every service, and the run is as without the option. With a list, every check of
a service not in the list is `not-run` with the message
`service <s> not touched: its checks are not part of this run`; a name that no row has selects nothing and is not an
error. A file that cannot be read, is not that shape or holds an entry that is not a service name makes every check
`error` (exit 127) before anything is built or started. When more than one reason applies to a check, the not-run
list's comes first, then on request, then the service: with `--on-request`, a check on request of a service not in
the list is `not-run` with the service's message. `report.json` holds `services`: the file's list, sorted without
repeats, or `null` when every service's checks were part of the run.

The checks on request and those of the services not touched are left out the way the listed ones are, by the same ids
file and the same pattern. A left-out engine check returns at once: `run` gives `cargo test` `EMUFORGE_IT_NOT_RUN`
naming `output/integration/not-run.ids`, and `support::check::check` prints `not-run <id>` and writes no verdict, so
`cargo test` shows that test as `ok`. A left-out Studio or product check is left out of the Playwright run with one
`--grep-invert` pattern of the left-out ids. `report.json` is the record: each left-out check is `not-run` with its
reason as its message, and counts neither as passed nor as failed; the exit code and relay fidelity are computed
over the other checks, and a run that leaves out every check gives 127. Everything else runs as when nothing is
left out, the product image's build included. When nothing is left out and no list is given, `run` writes neither
file and passes neither the variable nor the pattern.
