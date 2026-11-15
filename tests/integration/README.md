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
