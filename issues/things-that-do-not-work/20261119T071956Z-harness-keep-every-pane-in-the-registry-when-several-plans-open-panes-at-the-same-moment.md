Issue-Id: 504
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|pm-pane|registry-loses-panes-opened-at-once
Issue-Check-Ids:
Issue-Commit: 8da89c5ccae3269a6ad9fb32d7ef984f7254a7d6

# Keep every pane in the registry when several plans open panes at the same moment

> Identified against commit `8da89c5ccae3269a6ad9fb32d7ef984f7254a7d6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

At the restart of 2026-11-19 15:16 the `pm` opened four leads within a minute and three plans opened their rev and
worker panes within the same seconds (15:17). By 16:17 the registry `.pm/run/panes.json` held 9 live entries while
herdr held 12 agents of those issues: `i494-plan`, `i496-rev` and `i496-worker-s2` were not in it. `pm-pane` and
`pm-watchd` write the registry as load, change, save (`_pmlib.save`, a temp file renamed over it) with no lock, so two
writers at once lose one's entry. A pane that is not in the registry is invisible to the harness: its report lines
are not routed (`i496-worker-s2`'s `UNIT READY` at 15:28 and `i494-plan`'s `BLOCKED` at 15:21 reached nobody), no
`EVENT silent`, `ctx`, `gone` or orphans look covers it, and `pm-pane list` does not show it. Three issues stood for
an hour; nothing told the `pm`. The `pm` registered the three again with `pm-pane new … --adopt` at 16:18, and their
queued lines were delivered at once.

Wanted: every read-change-write of the registry (and of the other shared files under `.pm/run/` written the same way:
`waiting.json`, the daemon's state, `pm.json`) is one step under a lock, so writers at the same moment lose nothing; a
harness test that opens panes at once from several processes; and `pm-watchd` tells the `pm` when herdr holds an
agent named like a pane (`i<n>-…`) that the registry does not hold (`EVENT unregistered <name> <pane id>`), judged on
herdr's pane events, not on a timer.

Also here: the issue files of issues 342, 491 and 502 are closed (342 merged at `8da89c5` with its file left open;
491 and 502 are its duplicates) with `harness.check-stop`; and the briefs' close step of a harness-engineer is
checked by `pm-merge` for a harness issue (it refuses while the issue's file is still under
`things-that-do-not-work/` on the branch, unless the engineer's part is not the issue's last).

## Evidence

`.pm/run/events.log`, 2026-11-19 15:17 to 16:19 (the three panes' `pane new` lines, no routed line of theirs until 16:19:05); `pm-pane list` at 16:17 against `herdr agent list`.

## Steps to Reproduce

Run several `pm-pane new` at the same moment from different processes; compare the registry with `herdr agent list`.

## Expected

The registry holds every pane herdr holds, whatever the timing; a pane missing from it is told to the `pm` at once.

## Out of scope
