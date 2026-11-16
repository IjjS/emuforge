# Studio workflow

Stages of an issue whose `Issue-Module` is `studio`. The issue file under `issues/` states the problem and its
acceptance; the stage documents below are working files in the issue's folder and are reviewed by `rev` one at
a time. The owner is not asked to pick or approve a design at any stage.

## Screen grade

Decided at the Requirement stage and written into it. A screen's grade follows from the layer it is in
(`studio/AGENTS.md`, "Two layers"), and the layer decides the design system it is built from.

| Grade | Meaning | Layer and design system | Screen stage | Critique |
|---|---|---|---|---|
| `console` | The screen follows the information structure and flow of a screen of a provider's console; it is not a copy of it | a provider area only (AWS: `/aws` and below), built from that provider's design system (Cloudscape, default theme) | a reference spec per `console-reference.md` | structure score and impeccable score |
| `native` | The screen exists only in EmuForge | Studio's own layer (frame, Home, connection status, Studio's "Page not found", IAM simulator, Verify results): Studio's own design system (`studio/DESIGN.md`). Inside a provider area, an EmuForge-only state (the area's index, "no screen yet", the area's "Page not found"): the provider's design system, following its published patterns | a design per `critique.md` | impeccable score |
| `none` | No visible change | | skipped | skipped |

- Every screen of Studio's own layer is `native`; Studio's own layer has no `console` screen.
- Inside a provider area a screen is `console` when it follows the structure and flow of a screen of that
  provider's console, and `native` otherwise; both are built from the provider's design system, never from
  Studio's own, and both follow the AWS screen policy (`studio/AGENTS.md`, "AWS screen policy").

An issue that touches both a `console` and a `native` screen is split.

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
- The layer of each screen (Studio's own, or a provider area) and its route; a provider area's routes start with
  its segment (`/aws/...`).
- The grade, as it follows from the layer.
- What is out of scope, including parts of the AWS screen that are deliberately left out and why.
- For a `console` screen, the parts of the console screen (panels, tabs, navigation entries, badges) that are left
  out, each with the emulator's answer that shows it lacks the part (policy point 4). An action on a resource the
  emulator has is not left out; its 501, if the emulator answers one, is named here (point 5).
- For a `console` screen, the screen's EmuForge-own text, in English (point 3): its description, help, and empty,
  loading and error states, and the resource word of its local-emulator notice ("buckets": "These buckets are in
  your local emulator"). Each says only what the engine knows.
- For a screen of Studio's own layer, its text in English: every visible text, accessible name and announcement, as
  it will read in the English catalogue. The requirement does not give the other languages.

## 2. Screen

- `console`: write or update the reference spec for each screen, per `references/console-reference.md`, from the
  console screen's structure: its parts, their labels and their order, never its descriptions or help text. The
  spec is the design; there are no candidates.
- `native`: per `references/critique.md`: a mock, scored, revised until it passes. The mock is drawn in the
  design system of the screen's layer: Studio's own for Studio's own layer, the provider's for a state inside a
  provider area, where a native state follows Cloudscape's published patterns. A page of Studio's own layer that
  holds a provider area shows the area as a region in the provider's design system.

## 3. Test Criteria

Per `references/test-criteria.md`, before any code.

## 4. Implementation

In the issue's worktree, on its branch, only the files the unit owns. Conventions: `studio/AGENTS.md`, with the
rules of the layer the unit's files are in and the import boundaries between the layers.

The unit that adds or changes a text of Studio's own layer adds its key to every catalogue of `i18n/messages/` in
that unit: English in the requirement's wording, every other language translated in its catalogue's register with
the glossary's terms (`studio/AGENTS.md`, "Languages of Studio's own layer"). Its breakdown gives it the catalogues
for those keys, and `rev` reviews the register in that unit's review. Text inside a provider area is English only.

## 5. Critique

`crit` captures the implemented screens from the running app and scores them per `references/critique.md`, in
English and, for a screen of Studio's own layer, in German and Thai as well ("Captures and languages").
A screen that does not reach its pass line goes back to the worker once, then is scored again.

Then: the commands in `studio/AGENTS.md` pass, every integration check listed in stage 3 passes against a fresh
emulator, no check that passed on `main` now fails, `rev` reviews the implementation, and the `pm` merges.
