# studio

The web console frontend. The browser never talks to the emulator directly; every request goes through `engine`.

Stack: React, TypeScript, Vite, Cloudscape Design System, bun.

## Install

```sh
cd studio
bun install --frozen-lockfile
```

Every dependency is pinned to an exact version in `package.json`, and `bun.lock` is the only lock file. Playwright's
Chromium is not downloaded by the install; the flow checks under `tests/integration/studio` use the Chromium revision
that `@playwright/test` names (`bunx playwright install chromium` fetches it when it is missing).

## Checks

```sh
bun run typecheck      # tsc, strict
bun run lint           # ESLint, no warnings allowed
bun run format:check   # Prettier
bun run test:unit      # Vitest with jsdom; never `bun test`
bun run build          # type check, then Vite into studio/dist/
```

## Serve

```sh
bun run build
bun run serve
```

`bun run serve` runs Studio's own server (`scripts/serve.ts`). It serves `studio/dist/` on `127.0.0.1` only, on
`EMUFORGE_STUDIO_PORT` (default 8296), and tells the page the engine's port from `EMUFORGE_ENGINE_PORT` (default
8297). Open `http://127.0.0.1:8296/` with the engine running.
