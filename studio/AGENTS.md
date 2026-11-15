# studio

Guidance for agents working in `studio/`. The root `AGENTS.md` applies first; this file adds what is specific
to the web console. Stages for a studio issue are in `references/workflow.md`.

## What Studio is

A local console for cloud emulators, through the EmuForge engine. It has two layers. Studio's own layer is
EmuForge's frame and its own screens, in a design of its own. Inside it, each cloud provider has an area that
looks and behaves like that provider's console: the AWS area, at `/aws`, looks like the AWS console where an AWS
console screen exists, and like a careful Cloudscape application where it does not. Studio shows what is really in
the emulator, whoever created it, and it never pretends an operation works when the emulator answers HTTP 501.

Product context (users, purpose, scope) is in `PRODUCT.md`; Studio's own design system is recorded in `DESIGN.md`.

## Two layers

| Layer | What | Paths | Folders | Design system |
|---|---|---|---|---|
| Studio's own | the frame (top bar), Home with the connection status, Studio's "Page not found", every later screen that exists only in EmuForge outside a provider (settings, IAM simulation, Verify results) | `/` and every path that is not a provider's | `app/`, `ui/`, `features/` | Studio's own (`DESIGN.md`), original, imitating no provider's console |
| Provider area | everything of one provider; today the AWS area | the provider's first segment and every path below it: `/aws`, `/aws/...` | `providers/<id>/area/` | the provider's: Cloudscape for AWS, as the AWS console |

- The root of the path space belongs to Studio's own layer. Each provider has exactly one first segment (`aws`), and
  every path under it belongs to its area, including the area's EmuForge-only states (the area's index, "no screen
  yet", the area's "Page not found"). Any other path that matches no Studio screen shows Studio's own "Page not
  found". A service route is the provider's segment followed by the service's route: `/aws/s3`, `/aws/s3/buckets`.
- The area sits in Studio's frame, below the top bar, and fills the rest of the page. Studio's frame is never built
  from a provider's design system, and a provider's area holds nothing of Studio's own design.
- A screen's grade follows from its layer (`references/workflow.md`, "Screen grade"): every screen of Studio's own
  layer is `native` and is built from Studio's own design system. Inside a provider area, a screen that mirrors a
  screen of that provider's console is `console` and is built from the provider's design system against a reference
  spec (`references/console-reference.md`); an EmuForge-only state inside the area is `native` and is still built
  from the provider's design system, following that console's conventions.
- Neither layer's style leaks into the other: "No leak either way" below.

## Stack and structure

- bun only, one `bun.lock`. Dependencies are pinned to exact versions that were checked to be stable.
- React function components, Vite, TypeScript `strict`, React Router, TanStack Query, AWS SDK for JavaScript v3.
  Cloudscape Design System for the AWS area.
- One styling system per layer. Studio's own layer: plain CSS in Studio's own source with `--st-*` custom
  properties ("Studio's own layer" below); no Tailwind, no CSS-in-JS, no third-party component library. A provider
  area: that provider's design system only, Cloudscape for AWS; no other component library and no Studio component
  next to it.

```
studio/src/
  app/                         router, Studio's frame, the providers list (provider-list.ts), query client,
                               config, colour scheme of Studio's own layer; routes stay thin
  ui/                          Studio's own design system: tokens.css (--st-*), <component>.tsx, *.css
  features/<feature>/          Studio's own screens: home/ (with the connection status), not-found/
  i18n/                        the text of Studio's own layer: messages/<tag>.json (one catalogue per language),
                               glossary.json, the current language and its storage, the message function, time
                               and number formatting, the catalogue check; no UI
  providers/aws/provider.ts    the AWS entry of the providers list: names, segment, services (services.ts),
                               the area loaded with import(); plain data, no UI import
  providers/aws/area/          the AWS area: layout (AppLayout, SideNavigation, BreadcrumbGroup, colour mode),
                               its pages (index, "no screen yet", "Page not found"), components/ shared inside it
  providers/aws/area/services/<service>/
                               one folder per AWS service: api.ts, queries.ts, pages/, components/
  lib/                         aws client factory, engine client, errors, env; no UI
  test/                        test setup, and the support several test files share
```

- File names are kebab-case, components PascalCase, functions and variables camelCase. Event handlers are
  `handle*`, event props `on*`.
- A service folder imports nothing from another service folder. What two AWS services share moves to
  `providers/aws/area/components/` or `lib/`.
- Screen state that one screen owns stays local. There is no global store.

### Providers

- Studio has one list of providers, `app/provider-list.ts`. An entry gives the provider's name ("Amazon Web
  Services"), its short name for the frame ("AWS"), its first path segment (`aws`), its services for Home (label
  and path) and its area: the component that renders everything under its segment, loaded with a dynamic
  `import()`.
- The frame, Home and the router read that list and name no provider themselves. Adding a provider is one new
  entry and that provider's own folder (`providers/<id>/provider.ts`, `providers/<id>/area/`); it changes no file
  of Studio's own screens and no file of another provider's area.
- A provider's area brings its own design system and its own colour mode handling. Its code and styles load only
  when a path of the area is opened: a fresh load of `/`, or of Studio's "Page not found", requests no script or
  stylesheet of any area.
- No provider is listed or shown before it is built; there is no "coming soon".

### Import boundaries

- `@cloudscape-design/*` is imported only under `providers/aws/area/`.
- `providers/<id>/area/` imports nothing from `app/`, `ui/`, `features/` or another provider's folder.
- `ui/` and `features/` import nothing from `providers/*/area/`.
- Outside `providers/<id>/area/` nothing imports it statically; only its `provider.ts` loads it, with `import()`.
- `lib/` imports nothing from any UI folder (`app/`, `ui/`, `features/`, `providers/`). Every folder may import
  `lib/`.
- `i18n/` is Studio's own layer's only source of text. `app/`, `ui/` and `features/` may import it. `i18n/` imports
  nothing from `app/`, `ui/`, `features/` or `providers/` (a test of `i18n/` may render what reads it).
  `providers/<id>/area/` and `lib/` import nothing from `i18n/`: an area is in its console's language, and `lib/`
  has no text a user reads.
- `bun run lint` enforces these boundaries: it fails on a file that breaks one.

## Talking to AWS

- AWS SDK clients are created only in `src/lib/aws`, from one factory that sets the endpoint to the engine,
  `disableHostPrefix: true`, and path-style addressing for S3. A component never constructs a client.
- The endpoint is the engine on `127.0.0.1`. Never `localhost` (the SDK then moves the bucket name into the
  host name), and never an AWS host. The factory refuses any other endpoint.
- The browser holds no AWS key. The engine identifies the browser by its session and signs upstream itself.
- A URL that arrives in a response (a queue URL, a presigned URL, an endpoint) is displayed, never fetched.
- Each service has `api.ts` (SDK calls, mapped to plain typed results) and `queries.ts` (TanStack Query hooks),
  in its folder under `providers/aws/area/services/`. Query keys include every filter, sort and page token.
  Requests take the `AbortSignal`. A mutation invalidates the list and the detail it changed. A late response
  never overwrites a newer one.
- Pagination follows the API's own tokens. Never load "everything" to page on the client.

## Errors and states

- Every data screen has four states: loading, empty, error, loaded. Each is built and each is tested.
- HTTP 501 `NotImplemented` is its own state, not an error: "Not implemented by the emulator", with the
  operation name. The action that led there is shown as unavailable, never hidden and never faked.
- `AccessDenied` shows the reason the engine returned.
- The engine being unreachable and the emulator being unreachable are different messages with different
  recovery steps.
- No mock fallback, no canned data, no optimistic success outside tests.

## Studio's own layer

Applies to the frame, Home, Studio's "Page not found" and every other screen outside a provider area.

- Built from Studio's own components in `ui/` and its tokens, as `DESIGN.md` records them. Not built from
  Cloudscape or any provider's design system, and not imitating any provider's console.
- Plain CSS in Studio's own source. Tokens are CSS custom properties named `--st-*`, defined in `ui/tokens.css`
  for light and dark. Every rule of Studio's own sits in one CSS cascade layer named `studio`
  (`@layer studio`), so it can be told apart from a provider's in the built app and never outranks a provider's
  unlayered rules. No declaration in the `studio` layer is `!important`.
- No font, image or other asset from another origin; Studio's fonts are served from the app's own origin. No text
  is baked into an image.
- Light and dark follow the operating system's colour scheme, change with it while the page is open, and are not
  stored; there is no toggle. Studio's own layer sets `color-scheme` on `html`. A provider area follows the same
  scheme at the same time, through its own mode.
- Every page has exactly one `main` landmark. On Studio's own pages it is Studio's own, holding the content below
  the top bar; in a provider area it is the area's content region (`AppLayout`'s for AWS). The top bar is never
  inside `main`.
- Keyboard reaches every action in visible order with a visible focus indicator. Text and focus indicators meet
  WCAG 2.2 AA contrast in light and dark. At 1280 and 390 wide no page scrolls sideways.
- Its text comes from the catalogues of `i18n/`, in the current language ("Languages of Studio's own layer" below).
  The English text follows the wording the requirement gives; a screen of this layer has no reference spec.
- The language control sits in the frame's top bar on every page (`ui/language-control.tsx`), in Studio's own
  design, never inside a provider area. Its menu is drawn above everything of an area: the area's holder
  (`.st-area`) is its own stacking context (`isolation: isolate`, not inherited), so the area's own sticky and
  overlay layers stay under Studio's bar.

## Languages of Studio's own layer

Studio's own layer is shown in one current language at a time; the AWS area is English in every language. The
languages are the catalogue files in `i18n/messages/`, today twelve: `en` (the source and the fallback), `ko`, `ja`,
`es`, `pt-BR`, `fr`, `de`, `ru`, `it`, `pl`, `vi`, `th`. Every page is left to right; `dir` is never set.

### Where text lives

- Every text a user reads or hears in Studio's own layer comes from a catalogue, never from a string written in a
  component: visible text, the document title, the skip link, `aria-label`s and other accessible names,
  screen-reader-only text, live-region announcements, the names of commands and command groups. A component reads
  it with `useLanguage()` (`i18n/language-context.ts`): `t(key, values)` for a message, `plural(key, count, values)`
  for a counted one.
- No file under `app/`, `ui/` or `features/` holds a language tag other than `lang="en"`; `bun run test:unit` fails
  on one. What depends on a language is in `i18n/` or in CSS by `:lang()`.
- A catalogue is `i18n/messages/<tag>.json`, named by the language's BCP 47 tag: a flat JSON object from message key
  to text, or, for a counted message, to an object from plural category to text. Keys name the part of the screen
  they belong to (`connection.title`, `notice.startStep`). Two reserved entries sit beside the messages: `@name`,
  the language's own name ("Deutsch"), and `@sameAsEnglish`, the keys whose text is intentionally the same as
  English. A message key never starts with `@`.
- English (`en.json`) is the source: its keys are the full set. At run time a message missing from the current
  catalogue shows the English text; the catalogue check keeps that from happening on `main`.
- The catalogues are bundled (`i18n/bundled.ts`, every file imported eagerly), so the first render and a change of
  language need no request. Nothing else lists the languages.

### Adding a string

- A new text is a key in `en.json`, with the requirement's English wording, and the same key in every other
  catalogue, in the same unit. A text is never left in English in another catalogue to be translated later.
- Each catalogue keeps one register throughout, the polite one of software interfaces in that language (German
  "Sie", French "vous", Korean 합니다체, Japanese です・ます), and one term per concept. The shared terms are fixed in
  `i18n/glossary.json`: per English term ("engine", "emulator", "Refresh", "Home", "Studio", "command", "port") its
  English `forms`, the message keys where it is `exempt`, and per language the `stems` every inflected form of it
  holds. A text that contains a glossary term uses that language's stem. A new shared term adds an entry with a stem
  for every language. `rev` reviews the register in the review of the unit that writes the text.
- A text that is correctly the same as English in a language (a word the language borrows) is listed in that
  catalogue's `@sameAsEnglish`; that list is the only exemption.
- `bun run test:unit` runs the catalogue check (`i18n/catalogue-check.ts`) on every catalogue and fails, naming the
  catalogue and the key, on a key of English the catalogue lacks, a key English lacks, a placeholder dropped or
  renamed, a plural category the language needs and lacks, a text equal to English that `@sameAsEnglish` does not
  list, and a glossary term without its stem.

### Adding a language

- A language whose script already has a face (`DESIGN.md`, Typography) is one catalogue file
  `i18n/messages/<tag>.json`, with every key of English and its `@name`, and its stem in every term of
  `glossary.json`. It changes no screen code; the language control offers it from the file.
- A language in a script without a face also adds that script's face (`ui/fonts/`, its rule in `ui/fonts.css`, the
  font stack in `ui/tokens.css`) and its entry in `DESIGN.md`, Typography. A right-to-left language is not added
  without an issue of its own: Studio has no right-to-left layout.
- Removing a language is removing its file and its glossary stems.

### Placeholders and plurals

- A sentence that holds a value or an element (an origin, a port, a path, inline code, a count) is one message with
  a named placeholder, `{name}`, so each language places the value where its grammar needs it. A sentence is never
  assembled from separately translated pieces, and punctuation between a value and a text is part of the message
  (`"{code}: {message}"`).
- A placeholder's value is text or a React element (`InlineCode`, the engine's text), inserted as it is; never HTML.
- A counted message gives a form for every plural category its language has in `Intl.PluralRules`: English and
  German `one`, `other`; French, Spanish, Italian and Portuguese `one`, `many`, `other`; Russian and Polish `one`,
  `few`, `many`, `other`; Korean, Japanese, Vietnamese and Thai `other` only. `plural()` picks the form and fills
  `{count}` with the count formatted in that language. A category the browser asks for that the catalogue lacks
  shows that language's `other` form, never English.

### Dates and numbers

- Times, counts and durations of Studio's own layer are formatted in the current language through `i18n/format.ts`
  (the language's `formatTime` and `formatNumber`): a time of day with `Intl.DateTimeFormat`, hours 00 to 23, hour,
  minute and second; a count or a duration with `Intl.NumberFormat`. A formatted value changes with the language,
  not only when it is next computed.
- Ports, addresses, paths and HTTP status codes are literal text, put into a message as the text they are, never
  through `formatNumber`: port 9297 is "9297" in German, never "9.297".

### What is not translated

The same in every language, put into a message as a placeholder's value or shown beside it, never in a catalogue as
text to translate:

- the names "EmuForge" and "EmuForge Studio" (the wordmark and the document title's suffix), a provider's names
  ("Amazon Web Services", "AWS") and its service labels on Home (`providers/aws/services.ts`);
- commands, addresses, origins, ports, paths, container names, HTTP status codes and the engine's error codes;
- the engine's `message`, shown as it came, in an element with `lang="en"`;
- an area page's title where Studio's own layer shows or announces it, in an element with `lang="en"`; on a page of
  the area the document title stays `<area page title> | EmuForge Studio`, in English;
- a language's own name, the same in every language, in an element with that language's `lang`.

The engine's and the emulator's codes, reasons and messages do not depend on the browser's language; Studio maps a
`code` or a `reason` to its own words from the catalogues and shows a `message` as it came.

### `lang` attributes

- `<html lang>` is the current language's tag. `main.tsx` resolves the current language and sets it before the first
  render, so nothing is ever shown in English first; `LanguageProvider` keeps it in step after each change.
  `index.html` keeps `<html lang="en">` and the title "EmuForge Studio", which hold only until that first render.
- Text in another language than the page carries its own `lang`: the engine's message and an area page title
  `lang="en"`, a language's own name `lang="<tag>"`. The AWS area's root carries `lang="en"`.
- An element with its own `lang` is drawn in its own language's face and gets `hyphens: manual`, so it is never
  hyphenated by the page's rules.

### The current language and its storage

- Resolved once, at start (`i18n/language.ts`): a stored choice, else the first of the browser's preferred languages
  (`navigator.languages`, or `navigator.language` when that list is empty) that equals a catalogue's tag ignoring
  case or has its primary subtag (`de-AT` → `de`, `pt-PT` → `pt-BR`, `es-419` → `es`), else English. A change of the
  browser's languages, or a choice made in another tab, applies at the next load.
- A choice is stored in `localStorage` under the key `emuforge.studio.language`, its value the language's tag.
  "Browser language" removes the key; a stored value that is not a catalogue's tag is ignored and removed. When
  storage is blocked the choice still applies to the open page and nothing shows an error. That key is the only
  thing Studio stores.
- A change of language re-renders Studio's own layer in place, in one step: same path, no reload, no request to the
  engine, focus, scroll position and what is open kept. The AWS area is not re-rendered from scratch.

### Faces and layout in every language

- Faces per script are recorded in `DESIGN.md`, Typography: Latin runs in Instrument Sans in every language, each
  other script's runs in the face recorded for it, Vietnamese wholly in its own face, the wordmark in Instrument Sans,
  the code face unchanged. A system face is used only where the check environment draws every character of the
  language's catalogue with it; any other face is served from the app's own origin.
- The font stack is the `--st-font-ui` token, set per language with `:lang()` in `ui/tokens.css`. Every inherited
  text property that depends on a language (font stack, hyphenation, wrapping, line height, letter spacing) is set
  on `.st-bar` and `.st-main` or inside them, per language as `:lang(th) :is(.st-bar, .st-main)` or through a
  `--st-*` token read there; never on `html`, `body`, Studio's root or the area's holder ("No leak either way"). A
  `--st-*` token on `:root` is a custom property, not such a property.
- Every text of Studio's own layer hyphenates where its language allows or breaks inside its box (`hyphens: auto`,
  `overflow-wrap: break-word`); commands keep their unbroken lines. Thai, Korean and Japanese text has no negative
  letter spacing.
- At 1280 and 390 wide, light and dark, in every language, no page scrolls sideways, no text overflows its control
  or panel, and no label is cut; at 390 the top bar shows the wordmark, every navigation link and the language
  control (the globe alone at 480 and below).

## Inside a provider area: AWS and Cloudscape

Applies to everything under `providers/aws/area/`, at `/aws` and below.

- Use Cloudscape components and patterns as they are: `AppLayout`, `SideNavigation`, `BreadcrumbGroup`,
  `Header` with actions, `Table` with `collection-hooks`, `PropertyFilter` or `TextFilter`, `Pagination`,
  `Form` with `Container` and `FormField`, `Wizard`, `Modal`, `Flashbar`. Follow the AWS console's conventions,
  for the area's EmuForge-only states as well as for the screens that mirror the console.
- Style with Cloudscape design tokens only. No hardcoded color, spacing or font. No CSS that restyles a
  Cloudscape component's internals. No rule of the area names a `--st-*` property.
- Light and dark through Cloudscape's mode, applied to the area's root element only: in dark that element
  carries `awsui-dark-mode`. `html` and `body` never carry an `awsui-` class. Both modes are checked.
- The token declarations Cloudscape's base theme makes on `body` are made on the area's root as well, so an alias
  token (one defined as another token, such as the side navigation's panel background) resolves at the area's
  root and takes the dark value there in dark.
- Cloudscape's base applies inside the area: the rules of `@cloudscape-design/global-styles/index-base.css`
  (normalize and its `html` and `body` rules) are scoped to the area, their `html` and `body` rules to the area's
  root, and match nothing outside it. `@cloudscape-design/global-styles/index.css` is never applied to the
  document as a whole. Cloudscape's fonts (`global-styles/fonts.css`, `@font-face` only) are served from the
  app's own origin.
- Overlays stay in the area: no component uses `expandToViewport`, and a `Modal` renders into the area's root
  (`getModalRoot`), so no Cloudscape element is rendered outside the area. `bun run lint` fails on a use of
  `expandToViewport` under `providers/aws/area/`.
- A destructive action is confirmed in a `Modal`; where the AWS console asks the user to type a word or the
  resource name, so does Studio.
- The result of an action is announced in the `Flashbar`. A save in progress disables its button and keeps
  focus where it was.
- Fill every `ariaLabel` and `i18nStrings` a component asks for. A dialog traps focus, closes on Esc, and
  returns focus to what opened it.
- UI text is English, in every language of Studio, and follows the wording of the screen's reference spec. Do not
  paraphrase AWS's labels. The area imports nothing from `i18n/`; its root carries `lang="en"`; and everything it
  renders sits inside Cloudscape's `I18nProvider` with locale `en` and Cloudscape's English messages
  (`i18n/messages/all.en`). Cloudscape otherwise takes its locale from `<html lang>` and the browser's language, so a
  date, a number or a component's built-in text would follow Studio's language.
- A change of Studio's language does not re-render the area from scratch: its text, focus and state stay as they
  were. On a page of the area the frame is in Studio's language and the area in English, each marked by its `lang`.

## No leak either way

- Outside a provider area (the frame on every page, Studio's own screens, `html` and `body`) no element carries a
  Cloudscape class (`awsui*`), and no CSS rule outside the `studio` layer that sets a property other than a custom
  property matches any element. This holds on a fresh load and after visiting an area and coming back without a
  reload.
- The `data-awsui-focus-visible` attribute that Cloudscape sets on `body` while one of its components is mounted is
  Cloudscape's own and allowed; its focus rings depend on it.
- No rule of the `studio` layer matches an area's root or any element inside it. On the area's ancestors (`html`,
  `body`, any element that holds the area) the `studio` layer sets no inherited property other than
  `color-scheme` and Studio's own `--st-*` custom properties, so at the area's root every inherited text property
  computes to what Cloudscape's own base gives it.

## Security

- No `dangerouslySetInnerHTML`. Content that comes from the emulator (an S3 object, a log line, a tag value)
  is untrusted: rendered as text, never as HTML, never as a link that is followed automatically.
- The session token is kept in memory. It is never put in a URL, in `localStorage` or `sessionStorage`, or in a log.
  The one thing Studio puts in `localStorage` is the language choice (`emuforge.studio.language`).
- `VITE_*` values are public. No secret goes there.

## Tests

- Vitest for pure logic: mapping, formatting, query-key building, validation. Components are tested through
  what a user sees and does, with Testing Library, not through their internals.
- Playwright for flows a user can observe, against the real engine and a real emulator. These live in
  `/tests/integration/studio`, not here.
- Never replace `bun run test:unit` with `bun test`.
- Fixtures and fakes exist only in test files and under `src/test/`.
- A test reads Studio's English text unless it tests a language. A test about a language sets it the way a user's
  browser does (a stored choice, the browser's languages) or gives `i18n/` test catalogues; it never changes a
  catalogue of `i18n/messages/` or Studio's code for the test.

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
PRODUCT.md               product context: users, purpose, scope
DESIGN.md                Studio's own design system: tokens, type, components, the studio cascade layer
references/
  workflow.md            stages of a studio issue and what each produces, the grade by layer
  console-reference.md   reference specs for screens that mirror a provider's console, and the structure score
  critique.md            how screens are scored and what score lets a screen through
  test-criteria.md       form of the test cases, coverage axes
  console/               the reference specs, one file per screen
```
