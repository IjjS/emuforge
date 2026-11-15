Issue-Id: 32
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|i18n|final-critique-findings
Issue-Check-Ids:
Issue-Commit: d009b29c5fdb1b3c59b60e6d3d9d073fe0903fe4

# Keep Korean words whole at narrow widths and stop a tap that closes the language menu from following a link

> Identified against commit `d009b29c5fdb1b3c59b60e6d3d9d073fe0903fe4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Findings of the `final` critique of issue #17 (Studio in twelve languages), all below the level that holds a
screen back (P2 and P3), so they were not fixed there:

- Korean text breaks inside words at 390 wide (for example "에뮬 / 레이터를" on Home).
- At 480 wide and below, a tap outside the open language menu closes it on `pointerdown`, but the click still
  goes through; the only thing outside the menu there is Home's list of service links, so dismissing the menu
  opens an AWS page.
- At 390 the open menu's bottom edge cuts through page text with only a hairline between them.
- In interval messages the unit can stand alone on the last line ("Sekunden." in German at 390).
- Stiff wording in three catalogues: Korean `ko.json:54`, Japanese `ja.json:54` (a half-width "?"), German
  `de.json:59` ("Studio-Ursprung").

Reference: none; Studio's own layer (`studio/DESIGN.md`).

## Evidence

From `review-final.md` of issue #17 (built app at `9e401cd`, captures at 1280x800 and 390x844, light and dark):

- `studio/src/ui/base.css:51-63`: no `word-break: keep-all` for Korean among the per-script rules.
- `studio/src/ui/language-control.tsx:101-115`: the outside `pointerdown` closes the menu and lets the click
  through.
- `studio/src/ui/language-control.css:147-152`: nothing separates the menu from the page text under it at 390.
- `studio/src/i18n/messages/de.json:19, 38`: an ordinary space between `{count}` and its unit.

## Steps to Reproduce

1. Build and serve Studio, choose Korean, open `/` at 390 wide: words are split across lines.
2. At 390 wide open the language menu on `/` and tap a service link's row to dismiss it: the AWS page opens.

## Expected

- Korean words stay whole at every width (`word-break: keep-all` on Studio's own text in Korean), with no
  sideways scroll.
- A tap or click that dismisses the language menu does nothing else.
- The open menu is told apart from the page text under it at 480 and below.
- A count and its unit stay on one line in every language.
- The three wordings are revised in their catalogues, the glossary kept true.
- The screens keep their critique pass.

## Out of scope

- Other languages' wording; a native review of the catalogues is the owner's to arrange.
