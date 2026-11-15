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
typography:
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
---

# Design System: EmuForge Studio

This file records the design that passed the Screen stage of issue 16: the mock `.pm/issue-16/mocks/alt/` (picked
in that issue's `decisions.md`), with the changes its review (`review-candidate-alt.md`) asked the build to make
stated here as the design. It covers Studio's own layer only. Where this file and the mock differ, this file is the
design.

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
- One accent, verdigris (hue 187), for the primary action, the current tab, the provider link and the focus ring.
- Status in its own hues: green for connected, red for error and unreachable, blue for checking and information,
  grey for not started and unknown.
- Flat: depth from tone and hairlines, never from shadows.
- Instrument Sans for the interface; JetBrains Mono only for code, addresses, paths and commands.

### The two layers

Studio has two layers, and each screen belongs to exactly one.

| Layer           | What                                                                    | Design                                                                                             |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Studio's own    | the frame (top bar) on every page, Home, Studio's "Page not found"      | this file                                                                                          |
| A provider area | everything at `/aws` and below (and, later, each other provider's path) | that provider's own design system: Cloudscape components and tokens for AWS, as in the AWS console |

**The Two-Layer Rule.** Studio's design stops at the edge of a provider area, and the provider's stops at the edge
of Studio's. No Studio rule matches the area's root or anything inside it; no provider class or rule reaches
Studio's own elements, `html` or `body`. An EmuForge-only state inside a provider area (the `/aws` index, "no
screen yet", the area's "Page not found") is built from the provider's design system, not from this one.

**The One Layer Rule.** Every rule of Studio's own CSS sits in one cascade layer named `studio`
(`@layer studio { … }`). Being layered, it never outranks a provider's unlayered rules, and the built app tells
Studio's rules apart from a provider's by that layer. No declaration in the `studio` layer is `!important`.

**The Two Containers Rule.** Studio's own containers are the bar and the page (`main`). Every inherited property
(font, size, weight, line height, colour) and the universal, selection and focus rules start on those two and
never on a common ancestor of a provider area. `html` and `body` get only `color-scheme`, the `--st-*` tokens and
non-inherited properties (background, margin, scroll padding). The element that holds a provider area is layout
only (`display: block`), with no inherited property.

**The Prefix Rule.** Every Studio custom property is named `--st-*`. They are declared on `:root` and inherit
into a provider area, where nothing reads them: no provider rule names an `--st-*` property.

Styling is plain CSS in Studio's own source: no Tailwind, no CSS-in-JS, no third-party component library.

## Colors

A warm paper palette with one verdigris accent and four status hues, each pair measured for WCAG 2.2 AA in both
schemes. The frontmatter holds the values: each key `<name>` is the light value of `--st-<name>`, each
`<name>-dark` its value when the operating system's scheme is dark. Contrast figures below are computed from those
values (sRGB, WCAG 2.x), light / dark.

### Primary

- **Verdigris** (`accent`): the primary button's fill, the current tab's underline, the provider link on Home.
  Against the surface 6.37:1 / 9.16:1.
- **Deep Verdigris** (`accent-hover`): the hover of the primary button and the provider link.
- **Verdigris Ink** (`accent-ink`): text on the accent fill, 6.32:1 / 9.63:1.
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

### Named Rules

**The Shade Rule.** The overflow shade is at least 1.5:1 against `--st-sunk` at its edge, in both schemes.

**The One Accent Rule.** Verdigris marks what acts or where you are: the primary action, the current tab, the
provider link, focus. It is never a background for a section and never a status.

**The Status Hue Rule.** A status is never shown by colour alone: every status has its icon and its word.

## Typography

**Interface Font:** Instrument Sans (with `ui-sans-serif, system-ui, sans-serif`)
**Code Font:** JetBrains Mono (with `ui-monospace, monospace`)

**Character:** a plain, slightly narrow grotesque for the interface, with weights between the usual steps (560, 650) so emphasis is firm without shouting; a monospace that keeps commands and addresses legible and copyable.

Both faces are the latin subset, variable weight, WOFF2, from `@fontsource-variable/instrument-sans` and
`@fontsource-variable/jetbrains-mono` 5.3.0 (SIL Open Font License 1.1): Instrument Sans with weights 400 to 700,
JetBrains Mono 100 to 800, `font-display: swap`. They are files of Studio's own source, served from the app's own
origin. The licence text and copyright notices of both faces travel with the files, next to them (for example
`ui/fonts/OFL-instrument-sans.txt` and `ui/fonts/OFL-jetbrains-mono.txt`), as OFL 1.1 requires for redistribution.
No font comes from another origin, and no text is baked into an image.

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
- **Wordmark** (16px, -0.01em): "EmuForge" at 650 in `text`, then "Studio" at 400 in `text-2`.

### Named Rules

**The Mono Means Literal Rule.** The code font is for text a person types, copies or reads back exactly
(commands, addresses, paths, error codes). Never for labels or decoration.

## Layout

One column inside a sticky bar.

- **The bar** is 56px tall, sticky at the top, full width, with a gutter of 32px (16px below 640px). The wordmark
  sits left; the tabs follow with a 24px gap (12px below 480px).
- **The page** (`main`) is at most 1120px wide, with the gutter at each side, 40px above (28px below 640px) and
  72px below.
- **Rhythm:** the page head is 36px above the first section; sections are 40px apart; a section's header is 12px
  above its panel. Inside a panel the padding is 22px (16px below 640px).
- **Focus and in-page scrolling stop below the bar:** a stop scrolled into view clears the bar by 16px, set once
  (on `html`'s `scroll-padding-top`, or on the stops' `scroll-margin-top`, never both, so the offset does not count
  twice), and `html` has `scroll-padding-bottom: 16px` so a stop at the bottom of the viewport shows its whole ring.
  These are not inherited, so nothing reaches a provider area.
- **Breakpoints:**
  - 900px: Home's services go from three columns to two, filled by row in label order.
  - 640px: one column everywhere. The status rows stack, and each row is compact: the label and the status on one
    line, the address on the line under it, so the first recovery command of a notice stays high on a 390x844
    screen. A notice's icon moves into its heading so the text gets the full width. Services are one list. The
    copied state of a command shows no text beside the step label: the check icon and green edge on the button and
    the polite region carry it.
  - 480px: the bar's gap and the tabs' padding tighten (12px, 0 8px).
- **No sideways scroll** at 1280 and 390 wide. A command never wraps: its block scrolls within itself. The path
  on "Page not found" breaks only after a `/`; a segment wider than the box scrolls within the box.

### Named Rules

**The Grow Within Rule.** More providers grow the tab list, never the page: the tab list scrolls within the bar.
When it does not fit, "Studio" leaves the bar (it stays in the link's accessible name), the bar's right padding
goes, and the list's overflowing edge fades over its last 24px so a tab beyond it reads as more to scroll to.

## Elevation & Depth

Flat. There are no shadows. Depth comes from three tones (the page `bg`, the raised `surface` of the bar, panels and
command blocks, the `sunk` well of buttons, inline code and the path box) and from 1px hairlines. The bar is set
apart by its surface tone and the hairline under it, not by a shadow, even while sticky. The only shade in the
system is the overflow cue of the path box, and it means "more to scroll", not height.

### Named Rules

**The Hairline Rule.** Separation is a 1px `line` hairline or a change of tone, never a shadow.

## Shapes

Gently rounded and consistent: 6px (`s`) for small buttons, the path box and the focus ring; 10px (`m`) for
buttons and command blocks; 14px (`l`) for panels; 4px for inline code. A panel clips its contents to its corners,
so a notice band inside it follows the panel's curve. Icons are 24-unit line icons drawn at 15px to 20px with a
1.8 stroke and round caps and joins, `currentColor`, hidden from screen readers.

## Components

### The frame (Studio's bar)

- **Content:** the wordmark "EmuForge Studio" linking to `/`, then a navigation landmark labelled "Studio" with
  "Home" and one tab per provider from the providers list ("AWS").
- **Tabs:** 14px, 560, `text-2`, full bar height, 0 12px padding. Hover: `text`. Current: `text` with a 2px
  verdigris underline drawn inside the tab's bottom edge. "Home" is current on `/` (`aria-current="page"`); a
  provider's tab is current on its index (`page`) and marked current (`true`) anywhere deeper in its area.
- **Tab focus:** the ring sits inside the tab's padding (offset -4px), with the 8px radius of the tab's ring
  unchanged, so it never crosses the label.
- **Skip to content:** the frame's first Tab stop is a "Skip to content" link targeting `main`. It is hidden until
  focused, then shown at the bar's start with the focus ring, above the bar's other content.

### Panels

- **Corner Style:** 14px.
- **Background / Border:** `surface` with a 1px `line` edge; no shadow.
- **Internal Padding:** 22px (16px below 640px), set by the rows, notices and provider entry inside.

### Status rows (Connection)

- **Structure:** a description list of two rows, Engine and Emulator, side by side in the panel with a hairline
  between them; stacked below 640px with a hairline above the second, each compact (label and status inline,
  address under it).
- **Label:** 14px, 560, `text-2`.
- **Status:** an 18px icon and the word, 16px, 650, in the status hue: a filled check circle for "Connected", a
  crossed circle for "Error" and "Unreachable", an open circle for "Not started" and "Unknown", a clock for
  "Checking". The busy Refresh's arc icon spins (0.9s, linear), and stops under `prefers-reduced-motion`.
- **Address:** code font, 13px, `text-2`, one line, ellipsis when cut. An unknown address is "-" (hidden from
  screen readers) with "Not known" for a screen reader, in the interface font at 14px.

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
- **Inline code:** in a sentence, code font 13px on `sunk`, 4px radius, 1px 5px padding, never broken.

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

### Links

- **Provider link** (Home): the provider's name, 18px, 650, in `accent` with an arrow; hover `accent-hover` and
  an underline 4px below.
- **Service links** (Home): 15px in `text`, underlined at rest with a 1px `line-strong` underline 4px below, so
  they read as links on touch; hover `accent` text and underline.
- **Wordmark:** `text`, no underline.

### Focus ring

- **Everywhere in Studio's containers:** `:focus-visible` draws a 2px solid `focus` outline, offset 2px, with the
  6px radius. The frame's tabs are the one exception in offset (above). Nothing clips a focusable element, so its
  ring shows whole.

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
- **Do** serve Instrument Sans and JetBrains Mono from the app's own origin.
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
- **Don't** load a font, image or other asset from another origin, or bake text into an image.
- **Don't** use shadows for depth, or the accent as a status.
- **Don't** clip a focusable element with a mask or `overflow`, so its ring is never cut.
