Issue-Id: 52
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|pm-check|scope-by-diff
Issue-Check-Ids: harness.scope harness.check-scope harness.merge-scope
Issue-Commit: d76cc1d1c3af6c7dc64a5eca5051ed8810b0db25

# Run only the checks a branch's changes call for, decided from its diff

> Identified against commit `d76cc1d1c3af6c7dc64a5eca5051ed8810b0db25`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check` runs every module's steps whatever a branch changed, and `pm-merge` accepts only that full record. A
unit that changes one Studio sentence runs the harness's own 455 tests (5.5 minutes); a unit that changes one
harness script runs the 130 emulator checks (about 12 minutes); a unit that changes a guide runs both. A full
run is 17.5 minutes on `main`, a unit runs it several times (after its work, after each review fix, after each
merge of `main`), and closing an issue runs it once more on `main`. Almost all of the waiting in an issue is
this.

The owner wants two kinds of work told apart by what a branch changed: product work (Studio, engine) runs the
unit steps and the integration checks; harness work (`.pm/bin`, `.agents`) runs the harness tests. A script
reads the diff and decides.

Reference: none; the harness's own behavior.

## Evidence

`output/checks/last.json` of `main` at `fcb3089` (2026-11-16T13:13), a full run:

```
engine-fmt 0.2s  engine-clippy 0.3s  engine-test 5.1s
studio-typecheck 1.9s  studio-lint 1.6s  studio-format 0.8s  studio-unit 7.6s  studio-build 1.9s
integration 702.5s
harness-test 328.9s
```

- `pm-check --only <module>` exists, and its record says "partial run (--only): not accepted by pm-merge".
- Harness tests that read files outside `.pm/bin` and `.agents`: `test_docs` (the guides under
  `studio/references/` and the PM skill), `test_emulator_telemetry` and `test_compose_side_by_side`
  (`infra/aws-emulator/`), `test_capture` (Cloudscape as installed in `studio/`).
- `pm-merge` does not ask that the branch holds current `main` when its check passed.

## Steps to Reproduce

1. In a worktree, change one file under `.pm/bin/tests/` and run `pm-check <worktree>`: the integration step
   runs for about 12 minutes.
2. In a worktree, change one file under `studio/src/` and run it: the harness step runs for about 5.5 minutes.

## Expected

- One script of the harness reads what a branch changed against `main` and names the steps that change calls
  for. The rules are in one place, as data, with the reason for each:
  - `engine/`, `studio/` (code and tests), `tests/integration/`: the engine and Studio steps and the
    integration checks.
  - `.pm/bin/`, `.agents/`: the harness tests.
  - Paths a harness test reads (`studio/references/`, `infra/`, Studio's dependency files): the harness tests
    as well.
  - A path the rules do not know, or a diff the script cannot read: every step. The script fails toward
    running more, never less.
- `pm-check` runs the steps the script names and records which steps were called for and why; a step that was
  not called for is recorded as not needed, never as passed. `pm-merge` accepts a record that covers every
  step the branch's diff calls for, on the branch's current commit.
- `pm-merge` asks that the branch held the current `main` when its check passed (or that what `main` gained
  since calls for no step the branch did not run), so a merged `main` is what a passing check saw.
- A full run of every step still exists and is what `pm-check .` does on `main`; the rule for when the PM runs
  it (before a push) is the owner's to write in the PM skill.
- Harness tests cover the rules: each kind of change gives its steps; an unknown path gives every step; a
  branch behind `main` is refused; a record that skipped a called-for step is refused.

## Out of scope

- Making single checks faster (two integration checks take over two minutes each); that is its own issue.
- Splitting the harness tests into fast and slow groups.
