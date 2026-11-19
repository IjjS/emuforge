# Studio's own layer

Read this when a unit's files are in Studio's own layer (`app/`, `ui/`, `features/`, `i18n/`): the frame, Home,
Studio's "Page not found" and every other screen outside a provider area. Its design system is `DESIGN.md`, its
product context `PRODUCT.md`, its languages `languages.md`.

- Built from Studio's own components in `ui/` and its tokens, as `DESIGN.md` records them. Not built from
  Cloudscape or any provider's design system, and not imitating any provider's console.
- Plain CSS in Studio's own source. Tokens are CSS custom properties named `--st-*`, defined in `ui/tokens.css`
  for light and dark. Every rule of Studio's own sits in one CSS cascade layer named `studio`
  (`@layer studio`), so it can be told apart from a provider's in the built app and never outranks a provider's
  unlayered rules. No declaration in the `studio` layer is `!important`.
- Fonts, images and every other asset come from the app's own origin, and no text is baked into an image
  (`studio/AGENTS.md`, Security).
- Light and dark follow the operating system's colour scheme, change with it while the page is open, and are not
  stored; there is no toggle. Studio's own layer sets `color-scheme` on `html`. A provider area follows the same
  scheme at the same time, through its own mode.
- Every page has exactly one `main` landmark. On Studio's own pages it is Studio's own, holding the content below
  the top bar; in a provider area it is the area's content region (`AppLayout`'s for AWS). The top bar is never
  inside `main`.
- Text and focus indicators meet WCAG 2.2 AA contrast in light and dark, as the tokens of `DESIGN.md` give them.
- Its text comes from the catalogues of `i18n/`, in the current language (`languages.md`). The English text follows
  the wording the requirement gives.
- The language control sits in the frame's top bar on every page (`ui/language-control.tsx`), in Studio's own
  design, never inside a provider area. Its menu is drawn above everything of an area: the area's holder
  (`.st-area`) is its own stacking context (`isolation: isolate`, not inherited), so the area's own sticky and
  overlay layers stay under Studio's bar. An open dialog of the area is the one exception: while the area tells the
  frame one is open (`ProviderAreaProps.onModal`), the holder makes no stacking context (`.st-area-modal`), so the
  dialog and its backdrop are drawn above the bar, which covers nothing of the dialog and is inert; a press on the bar
  meets the dialog's backdrop. Once no dialog is open the holder isolates again (issue 531).
- `bun run brand` (`scripts/brand.ts`) writes every file of `brand/` and `public/` from `src/ui/brand-paths.ts` and
  the `--st-*` tokens, and draws the rasters with the headless Chromium of `@playwright/test`. Rerun it after a
  change of the geometry, the tokens or Instrument Sans, and commit what it writes; a build needs no browser. Its
  font parser (`fontkit`) is a development dependency imported by that script alone: nothing under `src/` imports
  it, or a file of `brand/` or `public/`.

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
