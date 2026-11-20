Issue-Id: 624
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|pm-brief-crit|rejects-engine-issue-with-studio-unit
Issue-Check-Ids:
Issue-Commit: 3254fce25e97f4b4be68dea86254e23480a2aded

# Generate a critique brief for an engine issue that changes Studio screens

> Identified against commit `3254fce25e97f4b4be68dea86254e23480a2aded`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The plan must arrange a critique for an issue that changes a Studio screen. The brief generator decides eligibility solely from Issue-Module. An engine issue with an approved Studio unit cannot generate its critique brief, even after that unit merges.

## Evidence

On issue 578, feat/578 at 3254fce25 contains changes to the RDS instance and cluster detail pages. The plan-set r3 passed. Running the critique brief generator printed “#578 has no screen to score (module engine)” and returned exit 1. The module guard in .pm/bin/pm-brief, cmd_crit, runs before target or worktree validation.

## Steps to Reproduce

1. Use a plan-led engine issue with a merged Studio screen unit.
2. Give pm-brief crit the issue ID, the changed routes and the absolute path of its collecting worktree.

## Expected

The plan can generate the standard critique brief for the actual Studio screen change and complete critique before implementation review. Keep the plan's permissions restricted to its issue.

## Out of scope

The RDS product implementation, changing the issue's module, and changing which critique findings must be fixed.
