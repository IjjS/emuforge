# Studio workflow

Stages of an issue whose `Issue-Module` is `studio`, led by its `plan` (`.agents/skills/pm/references/lead.md`).
The issue file states the problem; the stage documents are working files in the issue's folder, each reviewed by
`rev` before the next. The owner is not asked to pick or approve a design at any stage.

## What a service is

The emulator's API decides (owner, 2026-11-18: "무엇보다 제일 핵심은 emulator의 api야"). A service in Studio is what
the emulator supports of it, broken into the tasks a developer does with it locally (create a bucket and put an
object in it, invoke a function and read its log, give a role a policy), ordered by importance. A service may have
ten tasks or three, and one to three of them at its core; there is no fixed number. An issue builds from the top of
that order. Its screens serve those tasks and need not match the AWS console (`aws-area.md`, "AWS screen policy").

## Stages by kind

| Kind | 1 Requirement | 2 Design | 3 Test Criteria | 4 Build | 5 Integration tests, critique, whole check, review |
|---|---|---|---|---|---|
| `feature` | yes | yes | yes | yes | yes |
| `gap` | what is missing, and the task it serves | only when a flow or a screen changes | yes | yes | the critique only when a screen changes |
| `bug` | reproduction, expected behavior, cause | skip | yes, the regression included | yes | the critique only when the fix changes what is on screen |

`Requirement` and `Test Criteria` are never skipped.

## 1. Requirement

- What the emulator supports of the service today, found by calling it (start one on a free port, stop it after),
  never from memory or a model: each operation the tasks need, and whether it works or answers 501.
- The service's tasks, each with the operations it calls, in order of importance, the core ones marked; and which of
  them this issue builds.
- The routes and the layer of each screen: Studio's own, or a provider area (`/aws/...`).
- What is out of scope, and why.
- For a screen of the AWS area, its EmuForge-own text, in English (`aws-area.md`, point 3), and the resource word of
  its local-emulator notice ("buckets": "These buckets are in your local emulator").
- For a screen of Studio's own layer, its text in English: every visible text, accessible name and announcement, as
  it will read in the English catalogue (`languages.md`).

## 2. Design

`design.md`, reviewed by `rev` (stage `design`):

- Per task, its flow through the screens: which screen, what a developer finds and does there, and the API call
  behind each action.
- The console captures read for the flow's UX (their paths under `docs/aws-console/`; nothing of them is copied),
  and where the screen differs from the console on purpose.
- What the screens share with another service: a part a second service needs is lifted into the area's
  `components/` in this issue; a part one service needs stays in its folder.
- How the work splits into units (`breakdown.md`): `s<n>` units, each with its owned files.

There is no reference spec, no candidate and no required mock. The plan may ask `crit` for a mock of a screen when
the screen is new and large and it judges the build would otherwise be a guess; the mock is never required and
decides nothing but what the plan takes from it (`critique.md`).

## 3. Test Criteria

Per `references/test-criteria.md`, before any code.

## 4. Build

Each unit in its own worktree, by its worker, only the files it owns, with the unit tests its brief's scenarios ask.
Conventions: `studio/AGENTS.md`, and the reference its brief names for the layer its files are in (`aws-area.md`,
`own-layer.md`, `languages.md`). The worker shapes the screen's UI and UX.

A unit that adds or changes a text of Studio's own layer adds its key to every catalogue of `i18n/messages/` in
that unit (`languages.md`, "Adding a string"). Text inside a provider area is English only.

## 5. Integration tests, critique, whole check, review

Then: the commands in `studio/AGENTS.md` pass; the plan writes the integration tests from the scenarios of stage 3
(`tests/integration/AGENTS.md`); `crit` critiques each changed screen on the built app of the issue branch
(`critique.md`), and every P0 or P1 finding is fixed; only then the whole check on the issue branch passes, its
integration checks included, with no check that passed on `main` now failing; `rev` reviews the whole; and the
`pm` merges.
