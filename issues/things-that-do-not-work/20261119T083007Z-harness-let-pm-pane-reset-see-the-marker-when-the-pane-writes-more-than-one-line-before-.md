Issue-Id: 509
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|pm-pane|reset-marker-after-several-lines-not-matched
Issue-Check-Ids:
Issue-Commit: 773183246b8e66e307b80655ac968cb730f2efdd

# Let pm-pane reset see the marker when the pane writes more than one line before it

> Identified against commit `773183246b8e66e307b80655ac968cb730f2efdd`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-pane reset` failed three times on 2026-11-19 (`i503-plan` twice at 16:41 and 16:48, `i496-plan` at 17:22): each
pane wrote its note and printed `RESET READY <name> <nonce>`, and the script still answered "did not print the reset
marker within 7 min". The pattern of `_pmlib.reset_marker_pattern` asks for the reply's bullet (`⏺`), at most one
line after it, and then the marker; both panes wrote two or three lines of text before the marker in the same
reply ("The resume note is written to … / … / RESET READY i503-plan 164130"), so nothing matched. Tried on
`i496-plan`'s screen with `herdr pane wait-output`: the script's pattern times out on `recent-unwrapped`, `recent`
and `visible`; the plain marker matches, but its first match is the prompt's own echo, which is what the pattern
exists to avoid. Each failure costs seven minutes of the caller and leaves the pane with a full context; the `pm`
closed both panes and opened new ones on the same brief.

Wanted: the marker is seen wherever it stands in the pane's reply (any number of lines after the reply's bullet,
however the pane's width wraps them) and never in the echo of the prompt that asked for it; a harness test with a
reply of several lines before the marker, one with the marker alone, and one with only the echo.

## Evidence

`.pm/run/events.log` at the three times; the pattern printed for `RESET READY i496-plan 172231`: `[⏺•](?:[^❯›⎿└]*\n)?[^A-Za-z❯›⎿└\n]*RESET\s+READY\s+…`.

## Steps to Reproduce

`pm-pane reset <pane>` on a pane that writes a sentence or two before the marker line.

## Expected

The reset goes through when the pane has printed the marker.

## Out of scope
