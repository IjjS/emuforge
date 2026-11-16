Issue-Id: 41
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|language-control.menu|same-tone-over-controls-above-480
Issue-Check-Ids:
Issue-Commit: e1dc41c7c596aea2ef471a17fb3ee772417c0cdb

# Tell the open language menu apart from the controls it lies over above 480 wide

> Identified against commit `e1dc41c7c596aea2ef471a17fb3ee772417c0cdb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Above 480 wide the open language menu is a 248px box at the bar's end, drawn over the top of the page. Where it
lies over a control or a panel of the page, the menu's `surface` fill meets the same `surface` tone, and only the
menu's 1px edge tells the two apart: on Home with a notice, the menu covers part of the notice's "Refresh" button.
Issue #32 gave the menu a veil at 480 and below and left wider windows as they were (its requirement, R3.5).

Reference: none; Studio's own layer (`studio/DESIGN.md`, Language control; The Hairline Rule).

## Evidence

- The `mock` critique of issue #32 (`review-mock.md`, P3): in German at 1280 wide, with the emulator stopped, the
  menu lies over "Aktualisieren" with only its hairline between same-tone surfaces.
- Measured in the built app of `main` at `d8120a1`, 1280x800: the menu's box is 1000 to 1248px across and 53.5 to
  587.6px down; its fill and the panels' fill are both `oklch(0.993 0.003 85)`; its edge is
  `1px oklch(0.6 0.012 85)`; it has no shadow.
- `studio/src/ui/language-control.css:56-71`: the menu's fill, edge and place.

## Steps to Reproduce

1. Build and serve Studio with the engine running and no emulator, and open `/` at 1280 wide in German.
2. Open the language menu: its lower left part lies over the notice and its "Aktualisieren" button.

## Expected

- Above 480 wide, where the open menu lies over a control or a panel of the page, the menu is told apart from it
  by more than its 1px edge, within The Hairline Rule (a tone, never a shadow).
- The menu's options, keyboard and place are unchanged, and the screens keep their critique pass.

## Out of scope

- The menu at 480 wide and below (issue #32).
