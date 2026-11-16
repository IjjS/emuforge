Issue-Id: 44
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|page-head|lead-squeezed-at-narrow-width
Issue-Check-Ids:
Issue-Commit: 1073a1a8959e077cd33f03fae4a9edfccdb73b55

# Give the page head's lead its full width at 640 wide and below

> Identified against commit `1073a1a8959e077cd33f03fae4a9edfccdb73b55`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

At 640 wide and below, the head of a page of Studio's own layer keeps the lead paragraph beside the "Refresh"
button, so the lead is squeezed into a narrow column. In German at 390 it runs to three lines in about 180px.
Found by the `final` critique of issue #32 (P2, outside that issue's scope).

Reference: none; Studio's own layer (`studio/DESIGN.md`).

## Evidence

`review-final.md` of issue #32, on the built app at `b7ecf73`: `studio/src/ui/page.css:15-21`; captures of
Home in German at 390x844, light and dark (kept in the main checkout at `output/captures/32-final-de/`, local).

## Steps to Reproduce

1. Build and serve Studio, choose German, open `/` at 390 wide.
2. The lead under the page title wraps in a narrow column beside "Refresh".

## Expected

- At 640 wide and below the title and "Refresh" share one row and the lead takes the full width under them, in
  every language, with no sideways scroll.
- Above 640 the head is unchanged.
- The screen keeps its critique pass; a flow check covers the lead's width at 390.

## Out of scope

- The wording of the engine-unreachable notice (issue #42).
