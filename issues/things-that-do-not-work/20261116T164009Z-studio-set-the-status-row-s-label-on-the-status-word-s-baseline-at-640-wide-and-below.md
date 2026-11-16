Issue-Id: 65
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|status-rows|label-below-status-baseline-when-stacked
Issue-Check-Ids:
Issue-Commit: 0f728b10cbb379bb11d015a4ea80f28b752bfbfd

# Set the status row's label on the status word's baseline at 640 wide and below

> Identified against commit `0f728b10cbb379bb11d015a4ea80f28b752bfbfd`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On Home (`/`), at 640 wide and below, each row of the "Connection" section draws its label ("Engine", "Emulator")
beside the status (icon and word). The two are meant to sit on one baseline (`studio/src/ui/status-rows.css`:
the row is a grid with `align-items: baseline`), but the label's text sits about 3px lower than the status word.
The status is an inline flex box led by its icon, and the row aligns the label to that box's baseline, not to
the word's. It is the same in English, Korean and Japanese, in both rows.

Found by the `revised` critique of issue #60 (P3, outside that issue: its requirement keeps the label and the
status where they are). It is on `main` today and is not caused by issue #60's change.

Reference: none; Studio's own layer (`studio/DESIGN.md`, "Status rows").

## Evidence

Measured on the built Home of `main` at `e3e2027` (the row's files have not changed since), 320 wide, headless
Chromium, macOS; the bottom edge of the label's text against the bottom edge of the status word's text:

```
en  Engine row: label 371.9, status word 368.9    Emulator row: label 449.9, status word 446.9
ko  Engine row: label 303.4, status word 300.4    Emulator row: label 381.4, status word 378.4
ja  Engine row: label 350.9, status word 347.9    Emulator row: label 428.9, status word 425.9
```

The label is 14px and the status word 16px in the same face, with text boxes 18px and 20px high. On a shared
baseline the word's bottom edge would be at or just below the label's; it is 3px above it.

The critique's finding: `.pm/issue-60/review-revised.md` (P3, "the label sits 2-3px below the status word's
baseline"), on the captures `output/captures/revised-60/` (local).

## Steps to Reproduce

1. Build and serve Studio with an engine and an emulator running, open `/` at 320 wide.
2. In the "Connection" section compare the foot of "Engine" with the foot of "Connected" beside it: the label is
   about 3px lower.

## Expected

- At 640 wide and below, in every language of Studio, the label and the status word of a row stand on the same
  baseline (within 1px).
- The icon stays centred on the status word; the status's icon, word and hue do not change.
- From 641 wide the row is unchanged.
- The screen keeps its critique pass.

## Out of scope

- Where the address sits and how it wraps (issue #60).
- One shared status column for the two rows.
