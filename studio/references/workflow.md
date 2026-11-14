# Studio workflow

Stages of an issue whose `Issue-Module` is `studio`. The issue file under `issues/` states the problem and its
acceptance; the stage documents below are working files in the issue's folder and are reviewed by `rev` one at
a time. The owner is not asked to pick or approve a design at any stage.

## Screen grade

Decided at the Requirement stage and written into it.

| Grade | Meaning | Screen stage | Critique |
|---|---|---|---|
| `console` | The screen mirrors a screen of the AWS console | a reference spec per `console-reference.md` | structure score and impeccable score |
| `native` | The screen exists only in EmuForge: home, connection, IAM simulator, Verify results | a design per `critique.md` | impeccable score |
| `none` | No visible change | skipped | skipped |

An issue that touches both kinds of screen is split.

## Stages by kind

| Kind | 1 Requirement | 2 Screen | 3 Test Criteria | 4 Implementation | 5 Critique |
|---|---|---|---|---|---|
| `feature` | yes | by grade | yes | yes | by grade |
| `gap` | the difference from the reference screen | the spec item that differs | yes, including the item that differed | yes | by grade |
| `bug` | reproduction, expected behavior, cause | skip | yes, including the regression | yes | only when the fix changes what is on screen |

`Requirement` and `Test Criteria` are never skipped.

## 1. Requirement

- What the user is trying to do, and the path through the screens.
- Which AWS API operations the screens call, and what the emulator answers for each today: works, or 501.
  Find out by calling the emulator, not by reading a model.
- The grade.
- What is out of scope, including parts of the AWS screen that are deliberately left out and why.

## 2. Screen

- `console`: write or update the reference spec for each screen, per `references/console-reference.md`. The
  spec is the design; there are no candidates.
- `native`: per `references/critique.md`: a mock, scored, revised until it passes.

## 3. Test Criteria

Per `references/test-criteria.md`, before any code.

## 4. Implementation

In the issue's worktree, on its branch, only the files the unit owns. Conventions: `studio/AGENTS.md`.

## 5. Critique

`crit` captures the implemented screens from the running app and scores them per `references/critique.md`.
A screen that does not reach its pass line goes back to the worker once, then is scored again.

Then: the commands in `studio/AGENTS.md` pass, every integration check listed in stage 3 passes against a fresh
emulator, no check that passed on `main` now fails, `rev` reviews the implementation, and the `pm` merges.
