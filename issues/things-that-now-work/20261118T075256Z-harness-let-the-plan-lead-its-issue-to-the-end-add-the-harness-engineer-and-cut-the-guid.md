Issue-Id: 478
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|roles|plan-leads-an-issue-and-harness-engineer
Issue-Check-Ids: harness.lead harness.check-room harness.pane-effort harness.issue-branch-docs
Issue-Commit: f0cbdfa6e6199e140c0168907d540da69ac6f202

# Let the plan lead its issue to the end, add the harness engineer, and cut the guides to what every agent needs

> Identified against commit `f0cbdfa6e6199e140c0168907d540da69ac6f202`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner decided on 2026-11-18 how the agents work from now on, after two days in which the `pm` opened every
pane, gated every unit and became the place every issue waited, and in which the services' screens came out as
the same list, page and create form for every service. What follows is the owner's decision, to be written into
the guides and the scripts. Where a sentence here and a guide differ, the guide changes.

**Roles: six.** `pm`, `plan`, `worker`, `rev`, `crit`, `harness-engineer`.

- `pm`: orders the issues and gives each to a `plan` in a tab of its own; decides the weight of the follow-up
  issues a `plan`'s closing report names; merges an issue's collecting branch into `main`, pushes, reads the run;
  while it merges it looks the change over and files an issue of its own only for something critical. It talks
  to the owner. It edits no product code and writes no plan.
- `plan` (Opus 5.5): leads one issue from start to end. It writes the requirement, the design and the test
  criteria, and has them reviewed (and a screen critiqued where the issue has one). It makes the issue's
  collecting branch and worktree, cuts the work into units and gives each to a `worker` in a worktree of its
  own: a worker takes engine work or Studio work, never both, and an issue has as many of each as its size asks.
  The `plan` decides the cut; when it cannot, it tells the `pm` what the work is and the `pm` decides. Each
  worker's brief holds the unit-test scenarios that are its end condition. When every worker is done the `plan`
  writes the issue's integration tests itself, from the scenarios it wrote before the build, and runs them; it
  may leave them out where the issue is too slight or they would cost more than they show, and asks the `pm`
  when it cannot tell. Then it has `rev` and `crit` look at the whole. A fault found: by its size the `plan`
  either gives it to a worker at once or files it as an issue. It merges units into the collecting branch and
  reports the end to the `pm`. It edits test code and stage documents, never product code. It lives long: it
  keeps its state file current and goes on after a context reset.
- `worker`: implements one unit in its worktree and writes and runs its unit tests. No integration tests.
- `rev`: reviews from files only: the stage documents before the build, and at the end the implementation and
  whether the integration tests are the scenarios. Test author (`plan`), implementer (`worker`) and reviewer
  (`rev`) stay three.
- `crit`: scores Studio screens with the impeccable critique, on the built app.
- `harness-engineer`: plans and implements a harness issue alone. The `pm` reads its report and its change and
  judges it directly: no `plan`, `rev` or `crit` pane, and no checks but the harness tests of the scripts the
  change touches. Harness work is to be finished fast.

**Checks.** A script by which a `plan` or a worker asks to run a check: when the machine has room (CPU, memory
as measured) the check starts; when it has not, the script answers with an expected wait, from the checks
running and their recorded durations, and the asker comes back after it. The rule "one whole check at a time"
goes; more than one heavy check runs when there is room.

**What a service is (Studio).** The emulator's API decides. A `plan` finds what the emulator supports of a
service, breaks what a developer does with it locally into tasks, orders them by importance (a service may have
ten tasks or three, and one or three of them at its core) and builds from the top. Its test criteria are
business scenarios of those tasks against the real emulator. The console captures are a reference for UX, above
all for the flows that call the API; a screen need not match the console and may do what the console does not.
The structure score, the reference specs as a stage, and the per-screen checklist (every state, both widths,
keyboard order, the five rules) as obligations are removed. UI and UX are the worker's to shape and are judged by
the impeccable critique alone. Keyboard and safety (no request but to the engine and Studio's own origin, nothing
stored in the browser) are checked once, for the app and the area. Shared parts are lifted into the area when a
second service needs them, not before.

**The guides.** Every agent reads `AGENTS.md`, and a `plan` that writes integration tests reads
`tests/integration/AGENTS.md` too. `studio/AGENTS.md` is 619 lines (49 KB; "AWS screen policy" 16 KB and
"Languages of Studio's own layer" 11 KB). Each `AGENTS.md` keeps only what holds for every piece of work in its
module (safety, structure, what is forbidden, where things are), about a hundred lines; the rest moves to
`references/` files that a brief names when the work needs them. What this decision removes is deleted from the
guides, not moved.

Three parts, in this order, each brought to the `pm` when it is whole:
1. Roles and flow: root `AGENTS.md`, the PM skill, `pane-mode.md`, the review protocol, the briefs (`plan` as
   lead, `worker`, `rev`, `crit`, `harness-engineer`), the scripts a `plan` runs for its own issue (worktrees,
   panes, merging a unit into its collecting branch) and the events of an issue's panes going to its `plan`.
2. The script that asks for a check.
3. The guides cut down and the references split; the Studio and engine stage documents and test-criteria
   rules rewritten to the method above; the structure score and its files removed.

## Evidence

The owner's words of 2026-11-18 in the `pm`'s session (the decisions are quoted in
`.pm/issue-478/decisions.md`). Sizes: `wc` over the guides at `f0cbdfa`. The two days' record: `.pm/run/events.log`
(every unit event delivered to the `pm`), `.pm/archive/467/`, `.pm/archive/402/`.

## Steps to Reproduce

Not a fault to reproduce.

## Expected

A `pm` session that gives an issue to a `plan` and hears of it again at its closing report; a `plan` that can
open its workers, run its checks and merge its units without the `pm`; a harness issue done by one pane and the
`pm`; guides an agent can read whole before a small change.

## Out of scope
