Issue-Id: 495
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|pm-pane-reset|marker-wrapped-in-narrow-pane
Issue-Check-Ids: harness.pane-reset
Issue-Commit: 43491b31acc99b421dec8a7cc8644e2f65e0726b

# Let pm-pane reset find the reset marker when a narrow pane wraps it

> Identified against commit `43491b31acc99b421dec8a7cc8644e2f65e0726b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-pane reset <pane>` asks the pane to print `RESET READY <name> <nonce>` and waits for a row that holds the whole
marker (`.pm/bin/pm-pane`, the `wait-output` regex `(?m)^[^A-Za-z❯\n]*<marker>\s*$` on `recent-unwrapped`). In a
narrow pane (about 27–30 columns, with seven panes in one issue's tab) Claude Code lays its reply out at the pane's
width itself, so the marker reaches the terminal as two rows (`RESET READY` / `i486-worker-s2 102730`); unwrapping
soft wraps does not join them, the regex never matches, and the reset fails after 7 minutes every time, although the
pane wrote its note and printed the marker.

## Evidence

- 2026-11-19, issue 486: `pm-pane reset i486-worker-s2` three times, each `i486-worker-s2 did not print the reset
  marker within 7 min`; `herdr agent read i486-worker-s2` showed, each time, `⏺ RESET READY` on one row and
  `  i486-worker-s2 <nonce>` on the next (nonces 102730, 103438, 104151). Closing another pane of the tab did not widen
  it enough. The plan closed the pane and opened it again with its brief instead.

## Steps to Reproduce

1. Open enough panes in one issue's tab that a worker pane is under ~40 columns wide.
2. `pm-pane reset <that worker>`.
3. The pane prints the marker over two rows; the reset fails after 7 minutes.

## Expected

The reset finds the marker however the pane's width lays it out (for example by matching the marker with any
whitespace, line breaks included, between its words), and resets the pane.

## Out of scope

The tab's layout and how many panes an issue opens.

