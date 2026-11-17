Issue-Id: 327
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|integration|checks-by-touched-service
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Take only the touched services' browser checks in an issue branch's whole check, and the full set on the push of main

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration step grows with every service that gets screens, and the owner decided on 2026-11-17 that
nothing new runs side by side (issue 315, `decisions.md`). A unit's fast check already leaves the integration
step to the issue branch (issue 63), so the growth lands on two runs: the whole check of each issue branch
(`pm-check` on `feat/<id>`), which runs every check of the manifest once, and the run of each push of `main` on
GitHub Actions.

Issue 69 adds 18 browser checks and issue 70 adds 20. The browser checks on `main` take 4.2 s each without the
two that issue 315 puts on request, so a service adds about 80 s to every whole check; the service issues 69 to
314 would bring the step from five and a half minutes to several hours, for an issue that touches one service.

What could hold it, to be settled by the requirement: the whole check of an issue branch takes the browser
checks whose manifest row names, in `operations` (`<service>:<Operation>`), a service the branch's paths touch,
plus every check that belongs to no service; the full set runs on the push of `main`. That needs a rule from a
path to a service (`studio/src/providers/aws/area/services/<service>/` against the service names of
`operations`), a rule for the paths every service shares (the area's layout, `studio/src/lib/aws`, the engine),
`pm-scope`, `pm-check` and `pm-merge` agreeing on it, a way for `tests/integration/run` to take the choice (the
not-run list it has may do), and a decision on what "the whole check" of an issue means once it is no longer
every check. The last is a change of the merge condition and is the owner's.

## Evidence

- `.pm/issue-315/probe/record-main.txt` (from `output/checks/last.json` and `output/integration/report.json`
  of the main checkout at `12978b702`): the integration step 604.2 s for 130 checks; the 61 `studio.*` checks
  other than `studio.count-and-unit-stay-on-one-line` take 255.2 s, 4.18 s each.
- `.pm/issue-69/breakdown.md` (eighteen new flow checks) and `.pm/issue-70/breakdown.md` (twenty).
- `.pm/bin/pm-check`, docstring, kind `unit`: "except integration, which is left to the issue branch".
- `.pm/issue-315/requirement.md`, note N3.

## Steps to Reproduce

1. `pm-check <worktree>` on an issue branch whose paths touch one service's screens.
2. Read the `integration` step's seconds in `output/checks/last.json` and the checks in
   `output/integration/report.json`: every browser check of every service ran.

## Expected

- The whole check of an issue branch that touches one service's screens runs that service's browser checks and
  the checks that belong to no service, and reports every other service's browser checks as not run with the
  reason, never as passed.
- A branch whose paths are shared by the services, or cannot be mapped, runs every check.
- Every check of the manifest still runs for every commit of `main`: on the push run, or where the requirement
  puts it.
- The time of an issue branch's integration step does not grow with the number of services it does not touch.

## Out of scope

- Running checks side by side (owner decision of 2026-11-17, issue 315).
- The on-request kind of check (issue 315).
