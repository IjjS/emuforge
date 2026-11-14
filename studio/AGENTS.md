# studio

Guidance for agents working in `studio/`. The root `AGENTS.md` applies first; this file adds what is specific
to the web console. Stages for a studio issue are in `references/workflow.md`.

## What Studio is

A web console for the local emulator that looks and behaves like the AWS console where an AWS console screen
exists, and like a careful Cloudscape application where it does not. It shows what is really in the emulator,
whoever created it, and it never pretends an operation works when the emulator answers HTTP 501.

## Stack and structure

- bun only, one `bun.lock`. Dependencies are pinned to exact versions that were checked to be stable.
- React function components, Vite, TypeScript `strict`, React Router, TanStack Query, Cloudscape Design System,
  AWS SDK for JavaScript v3.
- No second styling system. No Tailwind, no CSS-in-JS, no component library next to Cloudscape.

```
studio/src/
  app/                  router, layout shell, providers; routes stay thin
  services/<service>/   one folder per AWS service: api.ts, queries.ts, pages/, components/
  features/<feature>/   EmuForge's own screens: home, connection, iam-simulator, verify
  components/           shared pieces built from Cloudscape
  lib/                  aws client factory, engine client, errors, env
```

- File names are kebab-case, components PascalCase, functions and variables camelCase. Event handlers are
  `handle*`, event props `on*`.
- A service folder imports nothing from another service folder. What two services share moves to `components/`
  or `lib/`.
- Screen state that one screen owns stays local. There is no global store.

## Talking to AWS

- AWS SDK clients are created only in `src/lib/aws`, from one factory that sets the endpoint to the engine,
  `disableHostPrefix: true`, and path-style addressing for S3. A component never constructs a client.
- The endpoint is the engine on `127.0.0.1`. Never `localhost` (the SDK then moves the bucket name into the
  host name), and never an AWS host. The factory refuses any other endpoint.
- The browser holds no AWS key. The engine identifies the browser by its session and signs upstream itself.
- A URL that arrives in a response (a queue URL, a presigned URL, an endpoint) is displayed, never fetched.
- Each service has `api.ts` (SDK calls, mapped to plain typed results) and `queries.ts` (TanStack Query hooks).
  Query keys include every filter, sort and page token. Requests take the `AbortSignal`. A mutation invalidates
  the list and the detail it changed. A late response never overwrites a newer one.
- Pagination follows the API's own tokens. Never load "everything" to page on the client.

## Errors and states

- Every data screen has four states: loading, empty, error, loaded. Each is built and each is tested.
- HTTP 501 `NotImplemented` is its own state, not an error: "Not implemented by the emulator", with the
  operation name. The action that led there is shown as unavailable, never hidden and never faked.
- `AccessDenied` shows the reason the engine returned.
- The engine being unreachable and the emulator being unreachable are different messages with different
  recovery steps.
- No mock fallback, no canned data, no optimistic success outside tests.

## Cloudscape

- Use Cloudscape components and patterns as they are: `AppLayout`, `SideNavigation`, `BreadcrumbGroup`,
  `Header` with actions, `Table` with `collection-hooks`, `PropertyFilter` or `TextFilter`, `Pagination`,
  `Form` with `Container` and `FormField`, `Wizard`, `Modal`, `Flashbar`.
- Style with Cloudscape design tokens only. No hardcoded color, spacing or font. No CSS that restyles a
  Cloudscape component's internals.
- Light and dark through Cloudscape's mode; both are checked.
- A destructive action is confirmed in a `Modal`; where the AWS console asks the user to type a word or the
  resource name, so does Studio.
- The result of an action is announced in the `Flashbar`. A save in progress disables its button and keeps
  focus where it was.
- Fill every `ariaLabel` and `i18nStrings` a component asks for. A dialog traps focus, closes on Esc, and
  returns focus to what opened it.
- UI text is English and follows the wording of the screen's reference spec. Do not paraphrase AWS's labels.

## Security

- No `dangerouslySetInnerHTML`. Content that comes from the emulator (an S3 object, a log line, a tag value)
  is untrusted: rendered as text, never as HTML, never as a link that is followed automatically.
- The session token is kept in memory. It is never put in a URL, in `localStorage` or `sessionStorage`, or in a log.
- `VITE_*` values are public. No secret goes there.

## Tests

- Vitest for pure logic: mapping, formatting, query-key building, validation. Components are tested through
  what a user sees and does, with Testing Library, not through their internals.
- Playwright for flows a user can observe, against the real engine and a real emulator. These live in
  `/tests/integration/studio`, not here.
- Never replace `bun run test:unit` with `bun test`.
- Fixtures exist only inside tests.

## Checks before review

```
bun run typecheck
bun run lint
bun run format:check
bun run test:unit
bun run build
```

All pass, with output saved under the worktree's `output/logs/`, before a review is requested.

## References

```
references/
  workflow.md            stages of a studio issue and what each produces
  console-reference.md   reference specs for screens that mirror the AWS console, and the structure score
  critique.md            how screens are scored and what score lets a screen through
  test-criteria.md       form of the test cases, coverage axes
  console/               the reference specs, one file per screen
```
