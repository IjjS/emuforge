Issue-Id: 63
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|issue-branch|integration-once-per-issue
Issue-Check-Ids: harness.issue-branch harness.check-issue harness.issue-branch-docs
Issue-Commit: e3e2027757e708c29b88927fb2c504a3fa4b1eda

# Collect an issue's units on one issue branch and run the integration checks once, before it merges into main

> Identified against commit `e3e2027757e708c29b88927fb2c504a3fa4b1eda`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Every unit of an issue is cut from `main`, runs the whole check of its scope and merges into `main` by itself.
A unit that touches the engine or Studio therefore runs the integration checks, about ten minutes with one
worker, and an issue of four or five units runs them four or five times. Only two heavy runs may go at once,
so with several issues in flight the units queue for them. Each unit's merge also moves `main`, and every open
pane is then told to merge it.

The owner's decision (2026-11-16): an issue's units are collected on one branch of the issue, and the
integration checks run once, on that branch, before it merges into `main`.

- An issue with more than one unit gets an issue branch cut from `main` (`feat/<id>`). Its units are cut from
  the issue branch, or stacked on a unit as today.
- A unit merges into the issue branch on its review pass and a fast check: everything of its scope but the
  integration suite (format, lint, types, unit tests, build; the harness tests when the harness changed).
- The unit that writes integration checks still runs the checks it wrote; an implementing unit may run single
  checks while it works. Neither is the gate.
- When the last unit is in, the issue branch takes `main` in, the whole check of the issue's scope runs once
  on it, and on a pass the issue branch merges into `main`, which is then pushed as issue #53 says.
- `main` is as checked as today: nothing reaches it that did not pass the integration checks of its scope.
- An issue of one unit is unchanged. A batch of `LOW` issues is one issue branch of its host.

## Evidence

Issue #56 on 2026-11-16: `t1`, `s1` and `s2` each ran `integration` before merging (612 s on `t1`,
`../emuforge-56-t1/output/checks/last.json`), and `s3` runs it again: four runs for one issue. Issue #45 ran
it for `s1`, `s2` and `h1` and once more on `main`. `.pm/run/events.log` holds the "main is at … merge it"
prompts sent after each unit's merge.

## Steps to Reproduce

1. Run an issue of three Studio units.
2. `integration` runs three times, once per unit, each about ten minutes, before anything is merged.

## Expected

- `pm-worktree`, `pm-check`, `pm-scope` and `pm-merge` know the issue branch: a unit's fast check and its merge
  into the issue branch; the issue's whole check and its merge into `main`. `pm-merge` refuses an issue branch
  whose last whole check did not pass on its head, or that does not hold `main`.
- A failed whole check names the failed checks so the `pm` can send it to the unit that owns them; the fix is
  a commit of that unit, merged into the issue branch again.
- The rule sentences say the same thing in the PM skill (flow steps 2, 3 and 5, the `LOW` batch), `pane-mode.md`
  and root `AGENTS.md`, and nothing still says that each unit runs the whole check or merges into `main`.
- Issues already in flight when this lands finish the old way; the scripts still serve them.
- The harness tests cover both paths.

## Out of scope

- Making the integration suite itself faster (more than one worker).
- What the check of `main` on GitHub Actions runs (issue #53).
