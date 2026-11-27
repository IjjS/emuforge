Issue-Id: 686
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|unit-fast-check|related-studio-unit-tests
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f

# A unit's fast check runs only the Studio unit tests related to its changed files

> Identified against commit `1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner asked for this on 2026-11-27. `pm-check` runs Studio's whole unit suite (`bun run test:unit`, 522 test
files on `main` at this commit) in every check, a unit's fast check included. With three Vitest slots and up to
sixteen worker panes, units queue for a slot: the suite is by far the longest step of a fast check, and the wait for
a slot is longer than the run.

A unit's fast check should run only the unit tests related to the files the unit changed against its issue branch
(Vitest's `related`, which follows the import graph from the changed files to the test files that reach them). The
whole suite still runs where a record takes a branch into `main`: the issue branch's whole check, a unit of an
issue without an issue branch, and a run on `main`.

## Evidence

Four unit checks that ended on 2026-11-27 between 15:00 and 16:30 KST (`output/checks/last.json` of the worktrees
`emuforge-75-s9`, `emuforge-70-s5`, `emuforge-75-s8`, `emuforge-664-s4`): `studio-unit` 447.1 s, 420.6 s, 433.2 s,
428.4 s; every other step of the same checks together under 100 s (engine steps under 10 s). On the same day a
worker of issue 651 reported a 30-minute wait for a Vitest slot (`.pm/issue-651/decisions-needed.md`, the `s9`
line). How much `related` saves has not been measured.

## Steps to Reproduce

1. In a unit worktree with a small Studio change, run `.pm/bin/pm-check .` and read `studio-unit`'s seconds in
   `output/checks/last.json`.
2. Compare with the time of the tests that import the changed files.

## Expected

- The plan states, with measured times on one small and one shared-path change, what a fast check runs and what it
  saves.
- A unit's fast check runs the related tests only and its record says so (which selection ran, from which base), so
  `pm-merge` can tell a related record from a whole one.
- A change the import graph cannot follow runs the whole suite: a changed path outside `studio/src` that the tests
  depend on (the Vite or Vitest configuration, `package.json`, `bun.lock`, the test setup file, TypeScript
  configuration), and any case the plan finds where `related` would miss a test.
- A merge into `main` still needs a record of the whole suite on the merged head, as today.
- The guides that describe a unit's fast check say what it now runs.
- Records made before the change stay valid for the merges they were made for, or the plan says how the issues in
  flight pass over.

## Out of scope

The test environment (issue 687), the number of Vitest slots, the integration tests, any Rust build tool.
