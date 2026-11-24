Issue-Id: 648
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|worker-pane-admission|shared-sixteen
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 2cff9665d5107361a32422403902c4e0b9575710

# Share sixteen worker pane slots across all work areas

> Identified against commit `2cff9665d5107361a32422403902c4e0b9575710`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Replace the four per-area worker admission limits with one shared maximum of sixteen open worker panes. The owner approved the aggregate limit.

## Evidence

_pmlib.room currently refuses a ninth Studio worker with 13/24 total panes and approximately 12 GB memory used; four of the eight Studio workers were idle but open.

## Steps to Reproduce

Inspect worker admission in room() and its callers in pm-pane and pm-watchd.

## Expected

The ninth worker in one area is eligible when other gates allow. The seventeenth worker across all areas waits. Both working and idle open worker panes count; non-worker roles only count toward total panes. Preserve the overall 24-pane limit, resource and token gates, and Vitest/integration limits. Verify the boundary and the queue wake path.

## Out of scope

Other admission thresholds and suite concurrency.
