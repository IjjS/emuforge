# studio

What holds for every piece of work in `studio/`. The root `AGENTS.md` applies first. Stages, conventions of a layer
and the critique are in `references/`; a brief names the ones its work needs ("References" below).

## What Studio is

A local console for cloud emulators, through the EmuForge engine. Studio's own layer is EmuForge's frame and its own
screens, in a design of its own (`DESIGN.md`). Inside it, each cloud provider has an area built from that provider's
design system: the AWS area, at `/aws`, is a Cloudscape application whose screens serve the tasks a developer does
with each service locally, as far as the emulator's API supports them; it is not a copy of the AWS console
(`references/aws-area.md`). Studio shows what is really in the emulator, whoever created it, and never pretends an
operation works when the emulator answers HTTP 501. Product context: `PRODUCT.md`.

| Layer | Paths | Folders | Design system |
|---|---|---|---|
| Studio's own: the frame, Home, Studio's "Page not found", every EmuForge-only screen outside a provider | `/` and every path that is not a provider's | `app/`, `ui/`, `features/`, `i18n/` | Studio's own (`DESIGN.md`), imitating no provider's console |
| A provider's area: everything of one provider, its EmuForge-only states included | its one first segment and below: `/aws`, `/aws/...` | `providers/<id>/area/` | the provider's, as published: Cloudscape in its default theme |

A path that matches no Studio screen shows Studio's own "Page not found", or the area's below its segment. Neither
layer's style leaks into the other (`references/own-layer.md`, "No leak either way").

## Stack and structure

- bun only, one `bun.lock`; dependencies pinned to exact versions checked to be stable. React function components,
  Vite, TypeScript `strict`, React Router, TanStack Query, AWS SDK for JavaScript v3, Cloudscape for the AWS area.
- One styling system per layer: plain CSS with `--st-*` properties in the `studio` cascade layer for Studio's own
  (no Tailwind, no CSS-in-JS, no third-party component library); the provider's design system alone in its area.

```
studio/
  brand/                       EmuForge's brand files (DESIGN.md, The logo), for use outside Studio, never shown on a
                               Studio screen
  public/                      what Studio serves at a fixed path: favicon.svg, favicon.ico, apple-touch-icon.png
  scripts/                     brand.ts (bun run brand), serve.ts (bun run serve), aws-area-styles.ts
  src/app/                     router, frame, providers list (provider-list.ts), query client, config
  src/ui/                      Studio's own design system: tokens.css (--st-*), components, brand-paths.ts
  src/features/<feature>/      Studio's own screens: home/, not-found/
  src/i18n/                    the text of Studio's own layer: messages/<tag>.json, glossary.json, format, check
  src/providers/aws/           provider.ts and services.ts (plain data); area/ the AWS area: layout, frame parts,
                               its own pages, components/ shared inside it
  src/providers/aws/area/services/<service>/
                               one folder per service: service.json, screens.ts, api.ts, queries.ts, pages/, components/
  src/lib/                     aws client factory, engine client, errors, env; no UI
  src/test/                    test setup and shared test support
```

- File names kebab-case, components PascalCase, functions and variables camelCase; handlers `handle*`, event props
  `on*`. Screen state stays local to its screen; there is no global store.
- A service folder imports nothing from another service folder; what two services share moves to the area's
  `components/` or `lib/` when the second one needs it. A service registers its screens in its own `screens.ts`;
  nothing of the area outside `services/` names a service's folder.
- `@cloudscape-design/*` is imported only under `providers/aws/area/`. `providers/<id>/area/` imports nothing from
  `app/`, `ui/`, `features/`, `i18n/` or another provider; outside it only its `provider.ts` loads it, with
  `import()` (the one exception is data: `services.ts` collects each `service.json`). `ui/` and `features/` import
  nothing from an area. `lib/` imports no UI folder and nothing from `i18n/`; `i18n/` imports no UI folder.
- `bun run lint` enforces these boundaries and fails on a file that breaks one.

## Talking to AWS

- AWS SDK clients are created only in `src/lib/aws`, from one factory that sets the endpoint to the engine,
  `disableHostPrefix: true`, and path-style addressing for S3. A component never constructs a client; a service
  hands its SDK client class to the factory from its `api.ts`, and a setting of the factory cannot be given.
- The endpoint is the engine on `127.0.0.1`. Never `localhost` (the SDK then moves the bucket name into the host
  name), and never an AWS host. The factory refuses any other endpoint, and refuses, before it is sent, any request
  whose address is not the engine's.
- The browser holds no AWS key. The engine identifies the browser by its session and signs upstream itself.
- A URL that arrives in a response (a queue URL, a presigned URL, an endpoint) is displayed, never fetched.
- A service's `api.ts` sends every command through `sendRequest` of `src/lib/aws/request.ts`, with the
  operation's name. It maps a failed request to the kinds the states below are shown from (not implemented,
  access denied, the emulator did not answer, the engine did not answer, any other code or status line) and
  ends a request at once when its signal aborts. No service folder maps a failure or awaits a signal itself.
- `queries.ts` holds a service's TanStack Query hooks. Requests take the `AbortSignal`; query keys include every
  filter, sort and page token; a mutation invalidates the list and the detail it changed; a late response never
  overwrites a newer one. Pagination follows the API's own tokens; never load "everything" to page on the client.

## Errors and states

- HTTP 501 `NotImplemented` is its own state, not an error: "Not implemented by the emulator", with the operation's
  name. The action that led there is shown as unavailable, never hidden and never faked.
- `AccessDenied` shows the reason the engine returned. The engine being unreachable and the emulator being
  unreachable are different messages with different recovery steps.
- No mock fallback, no canned data, no optimistic success outside tests.

## Security

- No `dangerouslySetInnerHTML`. Content that comes from the emulator (an S3 object, a log line, a tag value) is
  untrusted: rendered as text, never as HTML, never as a link that is followed automatically.
- No request but to the engine and Studio's own origin: no font, image, script or other asset from another origin.
  No text that Studio shows is baked into an image: what a Studio screen shows as text is live text from `i18n/`.
  The logo files and the social image in `brand/` hold letters as shapes; they are the exception, and no Studio
  screen shows them (a decision of issue 36).
- The session token is kept in memory: never in a URL, in `localStorage` or `sessionStorage`, or in a log. The one
  thing Studio stores is the language choice, in `localStorage` under `emuforge.studio.language`.
- `VITE_*` values are public. No secret goes there.
- No AWS logo, AWS service icon or resource icon; names are text (Cloudscape's own interface icons are used).
- The owner's console captures under `docs/aws-console/` (not in git) are the only part of `docs/` that is read,
  and nothing of them (markup, styles, scripts, images, descriptive text) is copied into the repository.

## Tests

- Vitest for logic and components (`bun run test:unit`, never `bun test`); components are tested through what a
  user sees and does, with Testing Library. A worker writes the unit tests its brief's scenarios ask.
- Flows through the built app against the real engine and a real emulator are integration checks, in
  `/tests/integration/studio`, written by the plan.
- Fixtures and fakes exist only in test files and under `src/test/`. A test reads Studio's English text unless it
  tests a language, and sets a language the way a user's browser does, never by changing a catalogue or the code.

## Checks

`bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test:unit` and `bun run build` all pass. They
run in `pm-check`, which records them and keeps their logs under the worktree's `output/logs/`.

## References

```
PRODUCT.md               product context: users, purpose, scope
DESIGN.md                Studio's own design system: tokens, type, components, the studio cascade layer
references/
  workflow.md            the stages of a studio issue: tasks, design, test criteria, build, critique (the plan)
  test-criteria.md       the scenarios: integration scenarios of the tasks, unit-test scenarios per unit (the plan)
  critique.md            how a screen is critiqued on the built app (the plan, crit)
  aws-area.md            the AWS screen policy, the emulator line and notice, Cloudscape in the area, the area in
                         Studio's frame, and what earlier critiques found: a unit with files under providers/aws/area/
  own-layer.md           the rules of Studio's own layer and "No leak either way": a unit with files in app/, ui/,
                         features/ or i18n/
  languages.md           the languages of Studio's own layer: a unit that adds or changes a text there, or a language
```

The plan reads every file; a worker's brief names the ones of its unit with `pm-brief worker --conventions`.
