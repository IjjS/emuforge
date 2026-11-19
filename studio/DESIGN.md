---
name: EmuForge Studio
description: Studio's own design system, for the screens only Studio has; each provider's area keeps that provider's console.
colors:
  # Light scheme. Values are OKLCH, the canonical source; `ui/tokens.css` declares each as `--st-<key>`.
  bg: 'oklch(0.972 0.005 85)'
  surface: 'oklch(0.993 0.003 85)'
  sunk: 'oklch(0.948 0.006 85)'
  line: 'oklch(0.885 0.007 85)'
  line-strong: 'oklch(0.79 0.009 85)'
  control-line: 'oklch(0.6 0.012 85)'
  text: 'oklch(0.23 0.012 255)'
  text-2: 'oklch(0.46 0.013 255)'
  accent: 'oklch(0.47 0.085 187)'
  accent-hover: 'oklch(0.4 0.08 187)'
  accent-ink: 'oklch(0.99 0.004 187)'
  accent-wash: 'oklch(0.92 0.035 187)'
  focus: 'oklch(0.52 0.12 187)'
  ok: 'oklch(0.5 0.13 150)'
  err: 'oklch(0.52 0.17 28)'
  err-wash: 'oklch(0.965 0.02 28)'
  err-line: 'oklch(0.86 0.06 28)'
  info: 'oklch(0.5 0.12 255)'
  info-wash: 'oklch(0.962 0.018 255)'
  info-line: 'oklch(0.86 0.05 255)'
  idle: 'oklch(0.52 0.012 255)'
  scroll-shade: 'oklch(0.3 0.02 85 / 0.28)'
  veil: 'oklch(0.972 0.005 85 / 0.75)'
  # Dark scheme: the same `--st-<key>` names, redeclared under `prefers-color-scheme: dark`.
  bg-dark: 'oklch(0.185 0.012 252)'
  surface-dark: 'oklch(0.225 0.013 252)'
  sunk-dark: 'oklch(0.162 0.011 252)'
  line-dark: 'oklch(0.32 0.014 252)'
  line-strong-dark: 'oklch(0.42 0.014 252)'
  control-line-dark: 'oklch(0.58 0.014 252)'
  text-dark: 'oklch(0.935 0.006 85)'
  text-2-dark: 'oklch(0.75 0.01 85)'
  accent-dark: 'oklch(0.79 0.085 187)'
  accent-hover-dark: 'oklch(0.86 0.075 187)'
  accent-ink-dark: 'oklch(0.2 0.03 187)'
  accent-wash-dark: 'oklch(0.33 0.045 187)'
  focus-dark: 'oklch(0.8 0.1 187)'
  ok-dark: 'oklch(0.78 0.14 150)'
  err-dark: 'oklch(0.75 0.14 28)'
  err-wash-dark: 'oklch(0.245 0.035 28)'
  err-line-dark: 'oklch(0.42 0.08 28)'
  info-dark: 'oklch(0.78 0.1 255)'
  info-wash-dark: 'oklch(0.24 0.03 255)'
  info-line-dark: 'oklch(0.42 0.07 255)'
  idle-dark: 'oklch(0.7 0.012 255)'
  scroll-shade-dark: 'oklch(1 0 0 / 0.18)'
  veil-dark: 'oklch(0.185 0.012 252 / 0.8)'
typography:
  # `fontFamily` is the stack of Latin text; the stack of each other script is under Typography, Faces per script.
  display:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '30px'
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: '-0.022em'
  headline:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '18px'
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: '-0.01em'
  title:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 560
    lineHeight: 1.5
  small:
    fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: 'JetBrains Mono, ui-monospace, monospace'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.55
rounded:
  s: '6px'
  m: '10px'
  l: '14px'
spacing:
  gutter: '32px'
  gutter-narrow: '16px'
  pad: '22px'
  pad-narrow: '16px'
  bar-height: '56px'
  page-max: '1120px'
components:
  bar:
    backgroundColor: '{colors.surface}'
    height: '{spacing.bar-height}'
    padding: '0 32px'
  nav-tab:
    textColor: '{colors.text-2}'
    typography: '{typography.label}'
    padding: '0 12px'
  nav-tab-current:
    textColor: '{colors.text}'
  panel:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.l}'
  status-row:
    padding: '18px 22px 20px'
  notice-err:
    backgroundColor: '{colors.err-wash}'
    padding: '20px 22px 22px'
  notice-info:
    backgroundColor: '{colors.info-wash}'
    padding: '20px 22px 22px'
  command-block:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.code}'
    rounded: '{rounded.m}'
    padding: '12px 14px'
  inline-code:
    backgroundColor: '{colors.sunk}'
    typography: '{typography.code}'
    rounded: '4px'
    padding: '1px 5px'
  button:
    backgroundColor: '{colors.sunk}'
    textColor: '{colors.text}'
    typography: '{typography.label}'
    rounded: '{rounded.m}'
    height: '36px'
    padding: '0 14px'
  button-hover:
    backgroundColor: '{colors.surface}'
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
    rounded: '{rounded.m}'
    height: '36px'
    padding: '0 14px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-small:
    backgroundColor: '{colors.sunk}'
    textColor: '{colors.text}'
    rounded: '{rounded.s}'
    height: '30px'
    padding: '0 10px'
  link-provider:
    textColor: '{colors.accent}'
    typography: '{typography.headline}'
  link-service:
    textColor: '{colors.text}'
    typography: '{typography.body}'
  path-box:
    backgroundColor: '{colors.sunk}'
    textColor: '{colors.text}'
    rounded: '{rounded.s}'
    padding: '6px 10px'
  language-control:
    textColor: '{colors.text-2}'
    typography: '{typography.label}'
    rounded: '{rounded.m}'
    height: '36px'
    padding: '0 10px 0 9px'
  language-control-open:
    backgroundColor: '{colors.sunk}'
    textColor: '{colors.text}'
  language-control-narrow:
    rounded: '{rounded.m}'
    height: '40px'
    width: '40px'
    padding: '0'
  language-menu:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.m}'
    width: '248px'
    padding: '6px'
  language-option:
    textColor: '{colors.text}'
    rounded: '{rounded.s}'
    height: '38px'
    padding: '6px 10px'
  language-option-hover:
    backgroundColor: '{colors.sunk}'
---

# Design System: EmuForge Studio

This file records the design that passed the Screen stage of issue 16: the mock `.pm/issue-16/mocks/alt/` (picked in
that issue's `decisions.md`), with the changes its review (`review-candidate-alt.md`) asked the build to make stated
here as the design. Issue 17 added the language control, the faces per script and the rules of text in other languages,
from its passed mock (`.pm/issue-17/mocks/`, revised r2) with the changes its review (`review-revised-r2.md`) asked for.
Issue 36 added the logo and the tile in the frame's wordmark, from its passed mock (`.pm/issue-36/mocks/`, revised r1)
as the build landed it. It covers Studio's own layer only. Where this file and a mock differ, this file is the design.

## Overview

**Creative North Star: "The Quiet Workbench"**

Studio is the bench the provider consoles sit on. Its own screens (the frame, Home with the connection status,
Studio's "Page not found") are warm paper and graphite with one verdigris accent, the patina of a worked metal.
Status speaks in its own hues; everything else stays out of the way. The surface is calm and dense enough for a
developer's tool: one column of panels, plain words, commands in monospace that can be copied as they are.

It is original. It imitates no provider's console, and it is not built from Cloudscape. In the dark scheme the
graphite takes the same blue cast as the Cloudscape dark layout of the AWS area, a step lighter, so Studio's bar
reads as the frame above the provider's surface rather than a different material.

**Key Characteristics:**

- Warm neutral surfaces (hue 85) in light, blue-cast graphite (hue 252) in dark; text in cool graphite (hue 255).
- One accent, verdigris (hue 187), for the primary action, the current tab, the provider link and the focus ring,
  and as the ground of the mark's tile.
- Status in its own hues: green for connected, red for error and unreachable, blue for checking and information,
  grey for not started and unknown.
- Flat: depth from tone and hairlines, never from shadows.
- Instrument Sans for the interface; JetBrains Mono only for code, addresses, paths and commands. A script
  Instrument Sans lacks is drawn in a face chosen for it, and Latin text stays Instrument Sans in every language but
  Vietnamese, which is wholly in its own face.
- Twelve languages, chosen in the bar; left to right in all of them.

### The two layers

Studio has two layers, and each screen belongs to exactly one.

| Layer           | What                                                                    | Design                                                                                             |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Studio's own    | the frame (top bar) on every page, Home, Studio's "Page not found"      | this file                                                                                          |
| A provider area | everything at `/aws` and below (and, later, each other provider's path) | that provider's own design system: Cloudscape components and tokens for AWS, as in the AWS console |

**The Two-Layer Rule.** Studio's design stops at the edge of a provider area, and the provider's stops at the edge
of Studio's. No Studio rule matches the area's root or anything inside it; no provider class or rule reaches
Studio's own elements, `html` or `body`. An EmuForge-only state inside a provider area (the `/aws` index, "no
screen yet", the area's "Page not found") is built from the provider's design system, not from this one. Studio's
own layer is in the current language; the AWS area is English in every language, and its root says so with
`lang="en"`, so the frame on an area page is the one place where two languages sit side by side, each marked.

**The One Layer Rule.** Every rule of Studio's own CSS sits in one cascade layer named `studio`
(`@layer studio { … }`). Being layered, it never outranks a provider's unlayered rules, and the built app tells
Studio's rules apart from a provider's by that layer. No declaration in the `studio` layer is `!important`.

**The Two Containers Rule.** Studio's own containers are the bar and the page (`main`). Every inherited property
(font, size, weight, line height, colour) and the universal, selection and focus rules start on those two and
never on a common ancestor of a provider area. `html` and `body` get only `color-scheme`, the `--st-*` tokens and
non-inherited properties (background, margin, scroll padding). The element that holds a provider area (`.st-area`)
is layout only, with no inherited property: `display: block` and `isolation: isolate`.

**The Isolated Area Rule.** The holder of a provider area makes its own stacking context (`isolation: isolate`,
not inherited). However high the area's own layers go (Cloudscape's sticky and overlay layers reach `z-index`
7000), they stay inside it, under Studio's sticky bar and the language menu, and the area keeps its state behind
the open menu. Studio never raises its own layers to outbid a provider's.

**The Prefix Rule.** Every Studio custom property is named `--st-*`. They are declared on `:root` and inherit
into a provider area, where nothing reads them: no provider rule names an `--st-*` property.

Styling is plain CSS in Studio's own source: no Tailwind, no CSS-in-JS, no third-party component library.

## Colors

A warm paper palette with one verdigris accent and four status hues, each pair measured for WCAG 2.2 AA in both
schemes. The frontmatter holds the values: each key `<name>` is the light value of `--st-<name>`, each
`<name>-dark` its value when the operating system's scheme is dark. Contrast figures below are computed from those
values (sRGB, WCAG 2.x), light / dark.

### Primary

- **Verdigris** (`accent`): the primary button's fill, the current tab's underline, the provider link on Home, the
  ground of the mark's tile (The logo).
  Against the surface 6.37:1 / 9.16:1.
- **Deep Verdigris** (`accent-hover`): the hover of the primary button and the provider link.
- **Verdigris Ink** (`accent-ink`): text on the accent fill and the bird on the tile, 6.32:1 / 9.63:1.
- **Verdigris Wash** (`accent-wash`): text selection inside Studio's containers, with `text` on it.
- **Focus Verdigris** (`focus`): the focus ring. Against the page 4.57:1 / 10.40:1, against the surface
  4.86:1 / 9.54:1, against the notice washes at least 4.44:1 / 9.15:1.

### Neutral

- **Paper** (`bg`): the page background, set on `body`.
- **Sheet** (`surface`): the bar, panels and command blocks.
- **Well** (`sunk`): button fills, inline code and the path box; one step below the page.
- **Hairline** (`line`): dividers between rows, around panels and command blocks, under the bar.
- **Strong Hairline** (`line-strong`): the resting underline of Home's service links (1.78:1 to 1.90:1 against the
  page and surface in light, 2.02:1 to 2.20:1 in dark: a quiet mark; the link text itself is `text`).
- **Control Edge** (`control-line`): the edge of a button, at least 3:1 against what is around it (3.39:1 on
  `sunk`, 3.87:1 on `surface` in light; 4.00:1 and 4.52:1 in dark).
- **Graphite** (`text`): body text and headings, 15.57:1 / 15.39:1 on the page.
- **Soft Graphite** (`text-2`): secondary text (the lead, meta lines, row labels, the "Studio" half of the
  wordmark, resting tabs), at least 6.12:1 / 7.37:1 on every Studio surface.

### Status

- **Connected Green** (`ok`): the "Connected" status and a copied command's button.
- **Error Red** (`err`), with **Error Wash** (`err-wash`) and **Error Edge** (`err-line`): the "Error" and
  "Unreachable" statuses, a failed copy, and the error notice's band.
- **Information Blue** (`info`), with **Information Wash** (`info-wash`) and **Information Edge** (`info-line`):
  the "Checking" status and the information notice's band.
- **Idle Grey** (`idle`): "Not started" and "Unknown".

Each status colour is at least 5.37:1 / 6.40:1 on the surface and on its own wash.

### Overflow shade

- **Scroll Shade** (`scroll-shade`): the shade at an edge of the path box while more of the path lies beyond it.
  In light a graphite tint, 1.71:1 at the edge against `sunk`. In dark a light tint (`oklch(1 0 0 / 0.18)`), 1.68:1
  at the edge against `sunk`. This replaces the mock's dark value (`oklch(0 0 0 / 0.6)`, 1.05:1, invisible).

### Veil

- **Page Veil** (`veil`): the page's own ground at part opacity, laid over the page under the bar while the language
  menu is open at 480 wide and below (Language control), so the page fades toward its ground and the menu stands
  apart from it. Light `oklch(0.972 0.005 85 / 0.75)` (Paper at 0.75), dark `oklch(0.185 0.012 252 / 0.8)` (Paper
  at 0.8). Under it the page's text is at most 1.8:1 against its ground: 1.69:1 on `bg` and 1.71:1 on a panel in
  light, 1.73:1 and 1.70:1 in dark (15.4:1 or more without the veil). The menu's own text keeps its contrast, and
  the menu's `control-line` edge is 3.70:1 / 4.29:1 against a veiled panel.

### Named Rules

**The Shade Rule.** The overflow shade is at least 1.5:1 against `--st-sunk` at its edge, in both schemes.

**The One Accent Rule.** Verdigris marks what acts or where you are: the primary action, the current tab, the
provider link, focus. It is never a background for a section and never a status. The one use that is neither an
action, a place nor focus is the mark: the tile of the logo, the icons and the frame's wordmark is verdigris with
the bird in its ink.

**The Status Hue Rule.** A status is never shown by colour alone: every status has its icon and its word.

## Typography

**Interface Font:** Instrument Sans (with `ui-sans-serif, system-ui, sans-serif`)
**Code Font:** JetBrains Mono (with `ui-monospace, monospace`)

**Character:** a plain, slightly narrow grotesque for the interface, with weights between the usual steps (560, 650) so emphasis is firm without shouting; a monospace that keeps commands and addresses legible and copyable.

**Script Faces:** Noto Sans Thai for Thai, Noto Sans for Cyrillic and for Vietnamese; the platform's own face for
Korean and Japanese (Faces per script, below).

All served faces are variable weight, WOFF2, from `@fontsource-variable/instrument-sans`, `jetbrains-mono`,
`noto-sans` and `noto-sans-thai` 5.3.0 (SIL Open Font License 1.1), `font-display: swap`: Instrument Sans in its
`latin` and `latin-ext` subsets with weights 400 to 700, JetBrains Mono `latin` 100 to 800, Noto Sans `cyrillic`,
`latin` and `vietnamese` and Noto Sans Thai `thai` 100 to 900. Every Instrument Sans and Noto file is declared with
its Fontsource `unicode-range`, so the browser fetches a file only when a page draws a character of its range. They
are files of Studio's own source, served from the app's own origin. The licence text and copyright notices of each
face travel with the files, next to them (`ui/fonts/OFL-instrument-sans.txt`, `OFL-jetbrains-mono.txt`,
`OFL-noto-sans.txt`, `OFL-noto-sans-thai.txt`), as OFL 1.1 requires for redistribution. No font comes from another
origin, and no text Studio shows is baked into an image (the logo files hold their letters as outlines of
Instrument Sans and are never shown on a Studio screen; The logo).

Weights: 400 (text), 560 (labels, tabs, buttons), 650 (headings, status, the wordmark's "EmuForge").

### Hierarchy

- **Display** (650, 30px, 1.15, -0.022em, balanced wrap): the page's one `h1` ("Home", "Page not found").
- **Headline** (650, 18px, 1.3, -0.01em): a section heading ("Connection", "Providers") and the provider link.
  A counter beside it ("(1)") is 400 in `text-2`.
- **Title** (650, 16px, 1.35): a notice's heading; the status word in a row is 650 at 16px as well.
- **Body** (400, 15px, 1.5): text, set on the bar and the page. A lead or notice paragraph is at most 62ch / 70ch.
- **Label** (560, 14px): tabs, buttons, row labels, step labels, the disclosure's summary.
- **Small** (400, 14px, `text-2`): meta lines ("Last checked 16:05:12. Checked every 5 seconds.", with tabular
  figures), the re-check line, notes.
- **Code** (JetBrains Mono 400, 13px, 1.55): commands, addresses, inline code. The path on "Page not found" is
  15px in the code font, inside a 16px sentence.
- **Wordmark** (16px, -0.01em): the tile, then "EmuForge" at 650 in `text`, then "Studio" at 400 in `text-2`
  (The frame, below).

### Faces per script

Studio's twelve languages are English, Korean, Japanese, Spanish, Brazilian Portuguese, French, German, Russian,
Italian, Polish, Vietnamese and Thai. The interface face is drawn per script run: a Latin run (a name, a number, a
command's name in a sentence, a Latin word) is Instrument Sans in every language, and a run of another script is
drawn in the one face chosen for that script. A word is never drawn in two faces. The interface stack is the token
`--st-font-ui`:

| Text                                                          | Stack (`--st-font-ui`)                                                                                                                | Face of the script's own runs                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| English, Spanish, Portuguese, French, German, Italian, Polish | `'Instrument Sans', 'Noto Sans Cyrillic', 'Noto Sans Thai', ui-sans-serif, system-ui, sans-serif`                                     | Instrument Sans: `latin`, and `latin-ext` for the letters Polish needs (ą ć ę ł ń ś ź ż)      |
| Russian                                                       | the same                                                                                                                              | Noto Sans `cyrillic` (as `Noto Sans Cyrillic`), by its `unicode-range` after Instrument Sans  |
| Thai                                                          | the same                                                                                                                              | Noto Sans Thai, by its `unicode-range` after Instrument Sans                                  |
| Vietnamese                                                    | `'Noto Sans Vietnamese', ui-sans-serif, system-ui, sans-serif`                                                                        | all of the text in Noto Sans (`latin` and `vietnamese` under one family name), Latin runs too |
| Korean                                                        | `'Instrument Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', ui-sans-serif, system-ui, sans-serif` | the platform's Hangul face                                                                    |
| Japanese                                                      | `'Instrument Sans', 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', 'Noto Sans CJK JP', ui-sans-serif, system-ui, sans-serif`        | the platform's kana and kanji face                                                            |

- **Why Vietnamese is whole:** its letters are Latin letters with marks Instrument Sans lacks (ạ, ế, ư, ơ), so a
  stack by run would draw one word in two faces. Every interface text of a Vietnamese page is Noto Sans.
- **Why Korean and Japanese use the platform's face:** a CJK face is too large to serve. The face must still draw
  every character of the catalogue with no fallback glyph in the check and capture environment (headless Chromium of
  `@playwright/test`); a language whose script has no such platform face there gets a served face instead.
- **The stack per element:** the token is set on `:root` by the page's language, and again on every element of the
  bar and the page that names its own `lang`, so a language's own name in another script (ไทย on a Japanese page,
  Русский or 한국어 on a Vietnamese one, "Tiếng Việt" on an English one) is drawn in its own script's face on every
  page.
- **The wordmark** "EmuForge Studio" is Instrument Sans in every language, Vietnamese too (`--st-font-mark`).
- **Code** is JetBrains Mono in every language; commands, addresses and paths are not translated.
- **Thai size:** Noto Sans Thai is declared with `size-adjust: 110%`. Measured at 100px, a Thai consonant's body
  (น, อ, ก) is 55px against Instrument Sans's 51px x-height, yet in a mixed line Thai reads smaller (thin strokes,
  small counters); at 110% the body is about 1.18 x-height and 0.84 cap height, so Thai and the Latin words beside
  it read as one size.
- **Before the menu opens:** the first pointer over or focus on the language control loads the faces of every
  language's own name (`document.fonts.load()`), so no name swaps its face while the menu is open the first time.
- **A new script** adds its face here and in `ui/fonts.css`, with its licence file beside it; a new language in a
  script that already has a face adds no CSS.

### Text in every language

- **One scale:** the sizes, weights and spacing of the hierarchy hold in every script.
- **No negative tracking on Thai, Korean or Japanese:** text in those languages has `letter-spacing: 0` (Display
  and Headline lose their -0.022em and -0.01em); the wordmark, Latin in every language, keeps its own.
- **Thai line height:** a Thai page's text is at 1.7 and its headings at 1.45, for the marks above and below the
  line.
- **Thai wrapping:** Thai has no spaces between words and the browser breaks it by its dictionary. Its text has
  `text-wrap: pretty`, so a line does not end on a short tail. A loanword written in Thai letters that the
  dictionary does not know (คลาวด์ "cloud", เอนจิน "engine") would break inside; the Thai catalogue joins its
  letters with U+2060 WORD JOINER, so it breaks only before or after.
- **Korean wrapping:** Korean is written with spaces between words, and its lines break only at white space, never
  between two syllables of one word: Korean text of the bar and the page has `word-break: keep-all`, on a Korean bar
  or page and on an element that carries `lang="ko"` on a page in another language (the name "한국어"). The
  long-word guard still breaks a Korean word that alone is wider than its box. With whole words a paragraph can end
  on a line of one word, so Korean text of the page has `text-wrap: pretty`, as Thai has, and a notice's heading in
  Korean has `text-wrap: balance`.
- **The long-word guard:** all of Studio's text, in the bar and the page, has `hyphens: auto` (with
  `hyphenate-limit-chars: 12 5 5`) and `overflow-wrap: break-word`, so a long word (a German compound) hyphenates
  where its language allows, or breaks, inside its box instead of pushing the box wider. It is on every language,
  so a new language with long words needs no CSS. Inline code and commands are never broken (Components).
- **Text in another language than the page** (the engine's English message, a language's own name, an area page's
  English title) carries its own `lang`, takes its own language's face, and has `hyphens: manual` and
  `word-break: normal`: it is shown as it came, never hyphenated or kept whole by the page's language.
- **A count and its unit:** in every form of a counted message ("every 5 seconds", "19 services") the count is
  joined to its unit by U+00A0 NO-BREAK SPACE, never an ordinary space, so a line never parts the number from its
  unit; Korean has no space there and keeps none. In the `many` forms of Spanish, French, Italian and Portuguese
  ("{count} de segundos") the space after "de" or "di" is U+00A0 as well, so the unit is whole on the count's line.
  Every catalogue spells it as the escape `\u00a0`, as French spells its narrow no-break space `\u202f`, so it can be
  seen in the file and in a diff.
- **Direction:** every language is left to right; no page sets `dir` other than `ltr`.

### Named Rules

**The One Face Per Word Rule.** A word is drawn in one face: Latin runs in Instrument Sans (Vietnamese wholly in
Noto Sans), each other script's runs in its own face, no fallback glyph.

**The Mono Means Literal Rule.** The code font is for text a person types, copies or reads back exactly
(commands, addresses, paths, error codes). Never for labels or decoration.

## Layout

One column inside a sticky bar.

- **The bar** is 56px tall, sticky at the top, full width, with a gutter of 32px (16px below 640px). The wordmark
  sits left; the tabs follow with a 24px gap (8px at 480px and below); the language control sits at the bar's end.
- **The page** (`main`) is at most 1120px wide, with the gutter at each side, 40px above (28px below 640px) and
  72px below.
- **Rhythm:** the page head is 36px above the first section; sections are 40px apart; a section's header is 12px
  above its panel. Inside a panel the padding is 22px (16px below 640px).
- **Focus and in-page scrolling stop below the bar:** a stop scrolled into view clears the bar by 16px, set once
  (on `html`'s `scroll-padding-top`, or on the stops' `scroll-margin-top`, never both, so the offset does not count
  twice), and `html` has `scroll-padding-bottom: 16px` so a stop at the bottom of the viewport shows its whole ring.
  These are not inherited, so nothing reaches a provider area.
- **The bar is never scrolled to:** it is always in view, so the bar and everything in it carry a negative
  `scroll-margin-top` as deep as `html`'s `scroll-padding-top`; focus in the bar or its language menu never moves the
  page (issue 486).
- **Breakpoints:**
  - 900px: Home's services go from three columns to two, filled by row in label order.
  - 640px: the bar shows the tile at 24px with a 5px gap and "EmuForge" without "Studio", which stays in the link's
    accessible name; so at 481 to 640 wide the wordmark, every tab and the control fit in every language. One column
    everywhere. The status rows stack, and each row is compact: the label and the status on one line, the address on a
    line of its own under them, across the row, so the first recovery command of a notice stays high on a 390x844
    screen. A notice's icon moves into its heading so the text gets the full width. Services are one list. The copied
    state of a command shows no text beside the step label: the check icon and green edge on the button and the polite
    region carry it.
  - 480px: the bar's gap and the tabs' padding tighten (8px, 0 7px), and the language control is its globe alone,
    40px square, so the wordmark, every tab and the control fit at 390 in every language (Polish "Strona główna"
    with "Polski" would not). A tab that takes focus is scrolled into the tab list's view should the list overflow.
- **No sideways scroll** at 1280 and 390 wide, in every language. A command never wraps: its block scrolls within
  itself. The path on "Page not found" breaks only after a `/`; a segment wider than the box scrolls within the box.

### Named Rules

**The Grow Within Rule.** More providers grow the tab list, never the page: the tab list scrolls within the bar,
and the wordmark link (tile and text) keeps its size and never shrinks. Above 640px, when the list does not fit,
"Studio" is to leave the bar (it stays in the link's accessible name), the bar's right padding to go, and the list's
overflowing edge to fade over its last 24px so a tab beyond it reads as more to scroll to. That fallback is not
built yet (issue #38); today the list scrolls and nothing else changes. At 640px and below "Studio" is never drawn
(Layout, Breakpoints).

## Elevation & Depth

Flat. There are no shadows. Depth comes from three tones (the page `bg`, the raised `surface` of the bar, panels and
command blocks, the `sunk` well of buttons, inline code and the path box) and from 1px hairlines. The bar is set
apart by its surface tone and the hairline under it, not by a shadow, even while sticky. The only shade in the
system is the overflow cue of the path box, and it means "more to scroll", not height. Beside it, the veil
(`veil`) over the page while the language menu is open at 480 and below is a tone, not a shade: the page's own
ground at part opacity, with no edge, no shadow and no motion. It means "the page is behind the menu", not height.

### Named Rules

**The Hairline Rule.** Separation is a 1px `line` hairline or a change of tone, never a shadow.

## Shapes

Gently rounded and consistent: 6px (`s`) for small buttons, the path box and the focus ring; 10px (`m`) for
buttons and command blocks; 14px (`l`) for panels; 4px for inline code. A panel clips its contents to its corners,
so a notice band inside it follows the panel's curve. Icons are 24-unit line icons drawn at 15px to 20px with a
1.8 stroke and round caps and joins, `currentColor`, hidden from screen readers.

## The logo

The mark is EmuForge's, and Studio's design draws it. Of it only the symbol is a brand commitment (`PRODUCT.md`,
Brand Commitments); the tile, the lock-ups, the icons, the social image, their colours and proportions are this
file's design and change by the usual stages.

### Marks

- **Symbol:** the head and neck of an emu in profile, facing right: a crest of pointed feathers at the back of the
  crown, an almond eye cut out as a hole, a beak ending in a point at the right, a neck curving down to the left to
  a pointed base. One closed silhouette in one flat colour, the eye a hole that shows the ground.
- **Tile:** the symbol on a rounded square of side `S`, corner radius `0.22 S`. The head is the symbol's, scaled and
  moved only; the neck runs on along its curve and leaves the square through its bottom edge, where the square
  clips it. One tile composition serves every logo, icon and the frame.
- **Code sign:** `</>`, three round-capped strokes in the bird's colour at the tile's lower right. On the app icons
  only.
- **Compact logo:** the tile, then "EmuForge" to its right, centred on the tile's height.
- **Primary logo:** the tile, then "EmuForge" with "STUDIO" under it in letter-spaced capitals, left edges aligned,
  both lines inside the tile's height.
- **App icon:** the tile with the code sign, on three grounds: teal, cream, night.
- **Favicon:** the tile without the code sign.
- **Social image:** 1200 x 630, the primary logo for a light ground and the line "Your free, local cloud workspace"
  at the left, an illustration of three stacked windows at the right, two accent bands rising from the lower left.

The letters of a logo file are outlines of Instrument Sans ("EmuForge" at 650 with -0.01em tracking, "STUDIO" at
600), so a file draws the same without the face. In Studio itself the wordmark is live text (The frame, below).

### Files

One geometry, in `src/ui/brand-paths.ts` (the symbol path, the tile path and its placement, the code sign), drawn
into every file by `bun run brand` (`scripts/brand.ts`); the rasters are the vectors drawn by Chromium. Rerun it after
a change of the geometry, the tokens or the face, and commit the results.

| File                                                                              | What                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `brand/symbol.svg`                                                                | the symbol alone, `accent` on no ground                                  |
| `brand/logo-primary-light.svg`, `brand/logo-primary-dark.svg`                     | the primary logo for a light, a dark ground                              |
| `brand/logo-compact-light.svg`, `brand/logo-compact-dark.svg`                     | the compact logo for a light, a dark ground                              |
| `brand/app-icon-teal.svg`, `brand/app-icon-cream.svg`, `brand/app-icon-night.svg` | the app icon on each ground                                              |
| `brand/app-icon-teal-192.png`, `brand/app-icon-teal-512.png`                      | the teal app icon at 192 and 512 pixels                                  |
| `brand/app-icon-cream-192.png`, `brand/app-icon-cream-512.png`                    | the cream app icon at 192 and 512 pixels                                 |
| `brand/app-icon-night-192.png`, `brand/app-icon-night-512.png`                    | the night app icon at 192 and 512 pixels                                 |
| `brand/app-icon-teal-square.svg`                                                  | the teal app icon on a full square, the source of `apple-touch-icon.png` |
| `brand/social.svg`, `brand/social-1200x630.png`                                   | the social image and its raster                                          |
| `public/favicon.svg`                                                              | the favicon, with the light and the dark scheme inside                   |
| `public/favicon.ico`                                                              | the light favicon at 16, 32 and 48 pixels                                |
| `public/apple-touch-icon.png`                                                     | 180 pixels, square and opaque (the device rounds it)                     |

The app icon PNGs are transparent outside the tile. `public/` holds what Studio serves at a fixed path; Vite copies it
to the root of the build, and the page links the three icons. `brand/` holds the rest; no Studio screen shows a file of
it. Every vector file holds only paths, rectangles, circles, groups, clip paths and their `defs`, a `title`, and the
favicon's one `style`: no text, no image, no filter, no opacity, no gradient, every painted area one token's opaque sRGB
value.

### Grounds

| Where                     | Ground                                   | Bird, code sign                                  | "EmuForge"  | "STUDIO"      |
| ------------------------- | ---------------------------------------- | ------------------------------------------------ | ----------- | ------------- |
| logo for a light ground   | tile `accent`                            | `accent-ink`                                     | `text`      | `accent`      |
| logo for a dark ground    | tile `accent-dark`                       | `accent-ink-dark`                                | `text-dark` | `accent-dark` |
| app icon, teal            | `accent`                                 | `accent-ink`                                     |             |               |
| app icon, cream           | `bg`, with a `line` edge                 | `accent`                                         |             |               |
| app icon, night           | `accent-ink-dark`                        | `accent-dark`                                    |             |               |
| symbol alone              | none                                     | `accent`                                         |             |               |
| favicon, the frame's tile | `accent`; `accent-dark` in a dark scheme | `accent-ink`; `accent-ink-dark` in a dark scheme |             |               |

A light-ground logo goes on paper, sheet or any light ground; a dark-ground logo on graphite or any dark ground.
The app icons keep their fixed colours and do not follow a scheme. In dark the tile turns mint and the bird dark
(`accent-dark`, `accent-ink-dark`): intended, the same inversion as every accent fill of the dark scheme.

### Clear space and smallest sizes

- **Clear space:** at least `0.25 S` free on every side of a logo or an icon, where `S` is the tile's side.
- **Smallest sizes:** the tile 16px; the compact logo 20px tall; the primary logo 32px tall. Below 64px no mark
  carries the code sign: its strokes would be about a pixel.

### In the frame

The wordmark link holds the tile, drawn inline by `ui/brand-tile.tsx` with the tile path and coloured by `--st-*`
properties, so it costs no request and is in the first paint (The frame, below).

## Components

### The frame (Studio's bar)

- **Content:** the wordmark (the tile, then "EmuForge Studio") linking to `/`, then a navigation landmark labelled
  "Studio" with "Home", "Connections" and one tab per provider from the providers list ("AWS"), then the language
  control at the bar's end. The bar is the same on every page, a provider area's pages too, and in the current language.
- **Tabs:** 14px, 560, `text-2`, full bar height, 0 12px padding. Hover: `text`. Current: `text` with a 2px
  verdigris underline drawn inside the tab's bottom edge. "Home" is current on `/` and "Connections" on `/connections` (`aria-current="page"`); a
  provider's tab is current on its index (`page`) and marked current (`true`) anywhere deeper in its area.
- **Wordmark:** the tile is 28px square with a 6px gap to the text; at 640px and below it is 24px with a 5px gap, and
  "Studio" is clipped out of sight (`position: absolute`, 1px square, `overflow: hidden`, `clip-path: inset(50%)`) and
  stays in the accessible name. The tile is `accent` with the bird in `accent-ink`, `accent-dark` with `accent-ink-dark`
  in dark, following the scheme while the page is open. It is decoration: hidden from assistive technology, so the
  link's accessible name is exactly "EmuForge Studio" in every language. The link never shrinks and has no hover style.
- **Wordmark focus:** the ring surrounds tile and text together, 4px out from the link's box, so 4px of the bar's
  surface lie between it and the tile's corner; with the 6px radius at that offset the ring's corner is about 10px.
  This and the tabs' are the two exceptions to the 2px offset.
- **Tab focus:** the ring sits inside the tab's padding (offset -4px), with the 8px radius of the tab's ring
  unchanged, so it never crosses the label.
- **Skip to content:** the frame's first Tab stop is a "Skip to content" link targeting the page's content: the
  content target the page names, past a provider area's navigation and breadcrumbs. It is hidden until focused,
  then shown at the bar's start with the focus ring, above the bar's other content. A route change moves focus to
  the new page's content target the same way, without a ring; a first load leaves focus at the document's start.

### Language control

The bar's last item, in the bar's Tab order after the tabs; never inside a provider area. A quiet control like the
tabs, with a control edge so it reads as something that opens.

- **Trigger:** a button with a globe icon, the current language's own name (in that language's `lang` and face)
  and a chevron. 36px tall, 0 10px 0 9px padding, 6px gap; label type (14px, 560) in `text-2`, no fill, a 1px
  `control-line` edge (3.87:1 / 4.00:1 against the bar's `surface`, as the buttons' edge), 10px radius, never
  wrapped. Its accessible name is "Language" and the own name, as the catalogue joins them ("Sprache: Deutsch"), so
  the name it shows is part of it.
- **States:** hover turns the text `text`; open (`aria-expanded="true"`) is `text` on `sunk` with the chevron
  turned 180° (120ms ease-out; none under `prefers-reduced-motion`); keyboard focus shows the 2px `focus` ring.
  There is no loading, empty or error state: a choice applies at once, and storage that cannot be written changes
  nothing visible.
- **480px and below:** the globe alone, 40px square (beside Studio's 36px buttons, a touch target of its own); the
  accessible name still names the language.
- **Menu:** a `menu` named "Language" in the current language, 248px wide, 8px under the trigger, aligned to its
  right edge; at 480px and below it spans the bar between the gutters, 4px under the bar. `surface` fill, 1px
  `control-line` edge, 10px radius, 6px padding, no shadow (The Hairline Rule). It is at most the visible height
  less the bar and 24px (`100dvh`, `100vh` where that is not known), and scrolls within itself without scrolling the
  page. It is drawn above everything of a provider area (The Isolated Area Rule).
- **Options:** `menuitemradio`s: "Browser language" first, in the current language, with the language the
  browser's languages resolve to under it (14px, 400, `text-2`, in that language's `lang`), its accessible name
  "Browser language, <name>"; a `line` separator; then the twelve languages by their own names, each in its own
  `lang` and face, in the order of `Intl.Collator('und')` (Deutsch, English, Español, Français, Italiano, Polski,
  Português, Tiếng Việt, Русский, ไทย, 한국어, 日本語). Each option is at least 38px tall, 6px 10px padding, 15px at
  1.35 in `text`, a 6px radius, an 18px check column 10px before the label.
- **Chosen and here:** exactly one option is checked: "Browser language" while no choice is stored, otherwise the
  stored language. The chosen option is marked by its check (in `accent`) and weight 560 only. `sunk` marks where
  the pointer or keyboard focus is, never the choice; focus draws the ring inside the option (offset -2px).
- **Keyboard:** Enter, Space or a click opens it, and so do Down and Up on the trigger. Opening puts focus on the
  checked option, so a reflexive Enter changes nothing. Down and Up move and wrap; Home and End go to the first and
  last; letters typed within half a second go to the next option whose label (an own name, or "Browser language")
  starts with them. Enter or Space chooses. Esc closes without a change; choosing closes; both put focus back on the
  trigger. Tab closes and moves on from the control. Focus that leaves the control closes it.
- **A press outside:** a press outside the control while the menu is open (a mouse click, a tap or a pen press, on
  the bar, the page, the veil or a provider area) closes the menu and does nothing else: a link under it is not
  followed, a button or a disclosure under it does not run, the path, the page's state and the stored language stay
  as they were, and no request is sent. Focus goes to the trigger, as after Esc, never to what the press did not
  activate. A press of the middle button closes the menu and opens no link, in this tab or another; a press of the
  secondary button closes it and the browser's own context menu may open; a touch drag closes it and the page may
  scroll with it; scrolling with a wheel or a trackpad leaves it open. Nothing is left pending: the next press acts
  as usual.
- **Veil (480px and below):** while the menu is open, a veil of `veil` lies over everything under the bar, from the
  bar's bottom edge to the bottom of the viewport and across its whole width, and stays there when the page
  scrolls. The bar is not veiled; the menu is drawn above the veil, in its own place and size. The veil is a tone
  (The Hairline Rule) and decoration: no role, no accessible name, no text, not focusable, hidden from the
  accessibility tree. It appears and goes with the menu with no motion, and opening or closing the menu moves
  nothing on the page: no layout shift, the scroll position kept. A press on it is a press outside. On a page of a
  provider area it covers the area as it covers Studio's own pages: it belongs to the frame, and nothing of it is
  rendered inside the area's root. Above 480 wide no veil is drawn; at every width the menu's own box, fill, edge,
  options and keyboard are the same.
- **Choosing:** applies at once, on the same page, without a reload: Studio's own text changes in one step, focus
  stays on the control, scroll and what is open stay. Choosing the checked option changes nothing. A language is
  stored in the browser (`emuforge.studio.language`); "Browser language" removes the stored choice.

### Panels

- **Corner Style:** 14px.
- **Background / Border:** `surface` with a 1px `line` edge; no shadow.
- **Internal Padding:** 22px (16px below 640px), set by the rows, notices and provider entry inside.

### Status rows (Connection)

- **Structure:** a description list of two rows, Engine and Emulator, side by side in the panel with a hairline
  between them, each with its label, status and address stacked from one left edge. At 640px and below they are
  stacked with a hairline above the second, each compact and in two lines: the label with the status beside it;
  then the address on a line of its own, from the row's left edge (under the label) and as wide as the row, 4px
  under the first. The stacked layout needs subgrid (the value lies across both of the row's columns and takes them
  as its own); a browser without it keeps the address under the status, beside the label, where it breaks rather
  than being cut.
- **Label:** 14px, 560, `text-2`.
- **Status:** an 18px icon and the word, 16px, 650, in the status hue: a filled check circle for "Connected", a
  crossed circle for "Error" and "Unreachable", an open circle for "Not started" and "Unknown", a clock for
  "Checking". The busy Refresh's arc icon spins (0.9s, linear), and stops under `prefers-reduced-motion`.
- **Address:** code font, 13px, `text-2`, on a 20px line (1.4 times the text when it is enlarged past that), never cut
  and never hyphenated: one line while it fits; when it does not, it breaks just before the ":" of its port and,
  failing that, at any character inside its box. The break point adds no text: what is read and copied is the address
  as it is. An unknown address is "-" (hidden from screen readers) with "Not known" for a screen reader, in the
  interface font at 14px, on the same 20px line.

### Notices

- **Place:** inside the Connection panel, under the rows, as a band across its width with a hairline above it.
- **Kinds:** error (`err-wash` band, `err-line` edge, triangle icon in `err`) and information (`info-wash`,
  `info-line`, circle-i icon in `info`).
- **Structure:** a 20px icon column beside the body (the icon moves into the heading below 640px); a heading
  (title, 16px, 650) with an optional "Refresh connection status" small button at its right; the re-check line in
  small `text-2` ("Studio checks again every 5 seconds; this page updates on its own."); then text, the engine's
  message ("Engine message:" / "Engine error:" at 560, the message as text that may break anywhere), the build-once
  disclosure and the numbered commands.
- **Semantics:** a notice is not a live region and not a group labelled by its own heading (the title is read
  once). The Connection section's own polite region announces each state change in one sentence.

### Command blocks

- **Structure:** a group labelled "Command: <name>", with the step label (14px, 560) and its "Copy" button on one
  line, and the command under it in a `pre`.
- **Block:** code font, 13px, 1.55, `surface` on the notice's wash, 1px `line` edge, 10px radius, 12px 14px
  padding. It never wraps; it scrolls within itself.
- **Steps:** every step in a notice has one width, set by the widest label or command, so each "Copy" button sits
  at its command's right edge; steps are 16px apart.
- **Copy:** a small button with a copy icon, visible label "Copy", accessible name "Copy command: <name>".
  Copied: the icon becomes a check and the button's text and edge turn `ok`; "Command copied" shows beside it at
  640px and wider (hidden from screen readers) and not at all below 640px. Not copied: the same in `err` with
  "Command not copied". The section's own polite copy region announces "Command copied" or "Command not copied",
  and is cleared after a short delay so a second copy is announced again.
- **Build once:** a disclosure ("First run? Build the image once, from the root of your EmuForge checkout"), 14px,
  560, with a chevron in `text-2` that turns 90° when open (160ms, `cubic-bezier(0.16, 1, 0.3, 1)`); the build
  command is inside it, 12px below the summary.
- **Inline code:** in a sentence, code font 13px on `sunk`, 4px radius, 1px 5px padding, never broken. An image or
  container name in a step label (`aws-emulator`, `emuforge-emulator-<port>`) is inline code, kept whole in every
  language.

### Buttons

- **Shape:** 10px radius, 36px tall, 0 14px padding, 8px between icon and label; label 14px, 560, never wrapped.
- **Default:** `sunk` fill, `text`, a 1px `control-line` edge (at least 3:1), so it reads as a control next to text.
- **Hover:** the edge turns `text-2` and the fill `surface`.
- **Primary:** `accent` fill and edge, `accent-ink` text; hover `accent-hover`. One per page at most ("Go to Home"
  on "Page not found").
- **Small:** 30px tall, 0 10px padding, 6px radius, 6px icon gap (the copy buttons and "Refresh connection
  status").
- **Busy:** the header "Refresh" while a check runs: `aria-disabled="true"`, `aria-busy="true"`, text `text-2`,
  progress cursor, the spinning arc icon.

- **Unavailable** (`ui/action-button.tsx`): an action that cannot be taken on this row (the target's "Remove"):
  `aria-disabled="true"`, still focusable and in the Tab order, described by its reason (a 13px `text-2` line beside
  the row's actions); a dashed `control-line` edge, no fill, `text-2`, a not-allowed cursor, no hover change. A choice
  of it does nothing. The same component draws a busy action ("Making target", "Testing", "Removing", "Adding") and a
  form's submit button.

### Text fields

- **Structure** (`ui/text-field.tsx`): the label (14px, 560), a hint under it (13px, `text-2`), the input 8px below,
  then an error when the value breaks a rule. The hint and the error describe the input.
- **Input:** 40px tall, 0 12px padding, 15px, `surface` fill, a 1px `control-line` edge (3:1), 10px radius; hover
  `text-2` edge. A field that holds code (a name, an endpoint) is in the code face at 14px, with no spelling check
  and no automatic capital.
- **Error:** the input's edge turns `err` and it is marked invalid; under it, 8px below, a 16px crossed circle and the
  text, 14px, in `err`. Focus moves to the first field in error when a form is sent.

### Dialogs

- **Structure** (`ui/dialog.tsx`): a modal panel centred over a `veil` that covers the viewport; `surface`, a 1px
  `line-strong` edge, 14px radius, at most 480px wide, 20px 22px padding, no shadow (The Hairline Rule). Its heading
  (18px, 650) names it, its text (`text-2`) describes it, a 32px close control named "Close" sits at the heading's
  end, and its buttons sit at the end, the confirming one primary.
- **Focus:** on opening, focus goes to the safe choice ("Cancel"); Tab and Shift+Tab stay inside; Escape, "Cancel"
  and "Close" close it, and the control that opened it gets focus back.

### Record lists

- **Structure** (`ui/record-list.tsx`): records in one panel, a `line` hairline between them, 18px 22px padding
  each. A record's fields sit side by side, each a label (13px, 560, `text-2`, the column's name) over its value; four
  columns above 900px, two to 900px, one at 640px and below. Under the fields: the record's actions (small buttons,
  8px apart), then what they produced.
- **Marked record:** a 3px `accent` bar at its start edge, with a mark beside its name: "Target" in 12px, 650,
  `accent` on `accent-wash`, a pill. It marks which one is chosen, not a status.

### Status lines

- **Structure** (`ui/status-line.tsx`): a status as the status rows draw it (its icon and word in its hue: `ok`,
  `err`, `idle`, `wait`), and under it, 4px below, a message in 14px `text-2` that may break anywhere (the engine's
  text, in its own `lang`). A small one (14px, 560, 16px icon) lists a test's checks.

### Connections (`/connections`)

- **Result line:** under the page head, one polite live region; a sentence about the last change in an `info-wash`
  band with an `info-line` edge, or `err-wash` and `err-line` for a refusal or a time limit; empty, it takes no room.
- **Rows:** one record per connection: Name (in the code face, 15px, 600, with the "Target" mark), Endpoint (code,
  13px), Emulator (a status line, the engine's message under it), Keys ("Keys are read by the engine from" and the
  folder as inline code). Actions "Make target", "Test", "Remove". A test's result follows: its summary (650, `ok` or
  `err`) in the row's own polite region, then the five checks on `sunk`, in a grid of 170px columns.
- **Add connection:** a section of its own under the list: Name and Endpoint side by side (stacked at 640px and
  below), "Add connection" at the end; a refusal that concerns neither field sits under them in an `err-wash` band.
  In the Compose form an information notice takes its place.

### Links

- **Provider link** (Home): the provider's name, 18px, 650, in `accent` with an arrow; hover `accent-hover` and
  an underline 4px below.
- **Service links** (Home): 15px in `text`, underlined at rest with a 1px `line-strong` underline 4px below, so
  they read as links on touch; hover `accent` text and underline.
- **Wordmark:** `text`, no underline, no hover style; its focus ring sits 4px out (The frame).

### Focus ring

- **Everywhere in Studio's containers:** `:focus-visible` draws a 2px solid `focus` outline, offset 2px, with the
  6px radius. Two exceptions in offset, both in the frame (above): the tabs' ring sits inside (-4px), the
  wordmark's 4px out. Nothing clips a focusable element, so its ring shows whole.

### Page not found (signature)

- **Content:** the `h1` "Page not found", the sentence "Studio has no page at <path>." (16px, `text-2`) and the
  primary "Go to Home".
- **Path box:** code font 15px in `text` on `sunk`, 1px `line` edge, 6px radius, 6px 10px padding, 8px above;
  each segment unbreakable, a break allowed only after `/`. The box sits on the sentence's baseline
  (`vertical-align: baseline` or `bottom`), so the sentence's "." follows the box's last line.
- **Overflow:** while the path is wider than its box, the box is a focusable, named scroller (`role="region"`,
  "Path") and shows the scroll shade at the edge where more lies; local covers in `sunk` hide the shade when the
  end is reached. No mask on the box, so its focus ring is never clipped.

## Do's and Don'ts

### Do:

- **Do** put every Studio rule in `@layer studio`, and name every Studio custom property `--st-*`.
- **Do** set inherited properties on Studio's bar and page only; give `html` and `body` only `color-scheme`, the
  tokens and non-inherited properties.
- **Do** follow the operating system's colour scheme, while the page is open, in both layers at once: `html` has
  `color-scheme: light` or `dark`; the AWS area's root carries `awsui-dark-mode` exactly when dark. Store nothing;
  there is no toggle.
- **Do** serve Instrument Sans, JetBrains Mono and every script's face from the app's own origin, each Instrument
  Sans and Noto file with its `unicode-range`.
- **Do** draw Latin runs in Instrument Sans in every language but Vietnamese, each other script in its own face,
  and mark every text in another language than the page with its `lang`.
- **Do** give every status its icon and word, every icon-only meaning a text alternative, and every focusable
  element the 2px `focus` ring.
- **Do** keep commands on one line each, scrolling within their block.

### Don't:

- **Don't** use Cloudscape, a Cloudscape class or a Cloudscape token in Studio's own layer, and don't imitate any
  provider's console there.
- **Don't** let a `studio` rule match a provider area's root or anything inside it, or set an inherited property
  (other than `color-scheme` and `--st-*`) on an ancestor of the area.
- **Don't** write `!important` in the `studio` layer.
- **Don't** use Tailwind, CSS-in-JS or a third-party component library.
- **Don't** load a font, image or other asset from another origin, or bake text Studio shows into an image. The
  logo files and the social image hold letters as shapes; no Studio screen shows them.
- **Don't** redraw, recolour, stretch, outline or shade the symbol, or give a mark an opacity or a gradient; draw
  the files from `src/ui/brand-paths.ts` with `bun run brand`.
- **Don't** use shadows for depth, or the accent as a status.
- **Don't** give Thai, Korean or Japanese text a negative letter spacing, or hyphenate text in another language
  than the page.
- **Don't** raise a Studio layer's `z-index` to cover a provider area: the area's holder isolates its stacking.
- **Don't** clip a focusable element with a mask or `overflow`, so its ring is never cut.
