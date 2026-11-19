# Lead: how a plan leads its issue

A `plan` leads one issue from its requirement to its closing report. The `pm` gave it the issue and hears of it
again only through the plan's `BLOCKED` lines and its closing line `ISSUE READY`. Everything in between is the
plan's: the stage documents, the cut into units, the worktrees, briefs and panes of its workers, the merges into the
issue's collecting branch `feat/<id>`, the integration tests, the whole check, the end review and critique.

## What you may do

- You act only on your own issue: its branches (`feat/<id>` and its units'), its worktrees and its panes (its
  workers, `rev` and `crit`). `pm-pane`, `pm-worktree`, `pm-merge` and `pm-brief` refuse you anything else, and
  every other script of the `pm`'s refuses you entirely.
- Of code you write integration tests only: never product code and never a worker's unit tests. You write the stage
  documents under `.pm/issue-<id>/`.
- You never merge into `main`, push, talk to the owner or start an issue. Only the `pm` does.
- The machine's limits are the scripts' to judge. `pm-pane` answers `QUEUE` and `pm-check` answers `WAIT` with an
  expected wait when there is no room; end your turn with `WAITING i<id>-plan room <role>` or
  `WAITING i<id>-plan check <worktree>`, and `EVENT room <you> pane <role> <side>` or
  `EVENT room <you> check <worktree>` arrives when there is.
- Every turn of yours ends with a typed line (`pane-mode.md`, Reporting lines): while your panes work, that is
  `WAITING i<id>-plan unit <unit>` or `WAITING i<id>-plan review <stage> r<k>`. A turn without one is
  `EVENT silent i<id>-plan` to the `pm`.

## Stages before the build

Two reviews by `rev` before any code, per `review-protocol.md` (owner, 2026-11-19): the requirement alone, then
the plan set. The module's `references/workflow.md` and `references/test-criteria.md` say what each document holds.

1. `requirement.md`. Find out what the emulator answers today by calling one (start it on a free port, stop it
   after); never from memory. Send `REVIEW requirement r1 .pm/issue-<id>/requirement.md` and end your turn with
   `WAITING i<id>-plan review requirement r1`.
2. On its `pass`, the plan set: write its three documents together, then send them in one line,
   `REVIEW plan-set r1 .pm/issue-<id>/design.md .pm/issue-<id>/test-criteria.md .pm/issue-<id>/breakdown.md`, and
   end your turn with `WAITING i<id>-plan review plan-set r1`. A `revise` names the document of each P1: fix those,
   and send the whole set again as r<k+1>.
   - `design.md`, the design stage your brief names (the module's `references/workflow.md`, stage 2); left out of
     the set when the workflow skips the design for the issue's kind.
   - `test-criteria.md`, from the requirement: per unit, the unit-test scenarios that are its worker's end
     condition; for the issue, the scenarios its integration tests will be. When you can already tell that an
     integration test will be left out (the issue is too slight, or the test would cost more than it shows), say
     so here, with the reason.
   - `breakdown.md`: the units, each with a one-line summary, its owned files, its base and the order they land in.

On the plan set's `pass`, the build starts.

## The cut

- A unit is `e<n>` (engine, CLI, IAM, Verify) or `s<n>` (Studio), never both; an issue has as many of each as its
  size asks. No unit takes more than a day.
- Units with overlapping owned files are sequential: the later one is stacked on the earlier
  (`--base feat/<id>-<unit>`).
- You decide the cut. When you cannot, stop with `BLOCKED i<id>-plan decision-needed cut <what the work is>`; the
  `pm` decides.

## Build

1. `pm-worktree new <id>`: the collecting branch `feat/<id>` and the issue's worktree `emuforge-<id>`, even for an
   issue of one unit.
2. Per unit: `pm-worktree new <id> <unit> [--base <unit branch>]`, then
   `pm-brief worker <id> <unit> --summary "<its line in breakdown.md>" [--scenarios "<where>"] [--close "<ids>"]`
   (`--close` for the unit that closes the issue), then
   `pm-pane new <id> worker --unit <unit> --cwd <its worktree> --brief .pm/issue-<id>/brief-<unit>.md`. You may
   pass `--effort low|medium|high|xhigh|max` to any pane you open, as the model goes; without it a worker runs at
   `medium`, `rev` and `crit` at `high`, and a pane opened again at the effort it had.
3. On a worker's `UNIT READY`: `pm-merge <id> <unit>` merges its branch into `feat/<id>` on its fast check. A unit
   is merged as many times as it is fixed.
4. After a merge, tell only a pane whose branch was cut from `feat/<id>` and that needs what it gained:
   `herdr agent prompt <pane> "feat/<id> is at <sha>; merge it into your branch"`. Telling every pane makes each
   check again for nothing.

## Integration tests

When every unit is merged, write the integration tests yourself in `emuforge-<id>` on `feat/<id>`: one per
integration scenario of `test-criteria.md`, as `tests/integration/AGENTS.md` says, and commit them. One that is left
out is said so in `test-criteria.md` before the build when you could tell then, and in `report.md` at the end. When
you cannot tell whether to leave one out, stop with `BLOCKED i<id>-plan decision-needed integration <scenario>`.
Leaving tests out does not leave the whole check out: `pm-merge` into `main` asks for its record.

## Critique

An issue that changes a Studio screen is critiqued before its whole check (owner, 2026-11-19): when every unit is
merged into `feat/<id>`, each on its fast check, run `pm-brief crit <id> --targets "<routes>" --capture-wt
emuforge-<id>`, then `pm-pane new <id> crit --brief .pm/issue-<id>/brief-crit.md`, and prompt it
`SCORE final <routes>`: the impeccable critique on the built app of `feat/<id>` (`studio/references/critique.md`).
Every P0 and P1 finding goes to the worker that owns the screen; it is fixed, passes its fast check and is merged,
and the screen is critiqued again. The score goes in `report.md` and decides nothing. A mock before the build is
never required: ask `crit` for one (`SCORE mock <file>`) only when a screen is new and large and the build would
otherwise be a guess. The integration tests may be written while the critique runs.

## Whole check

The whole check runs once every unit is merged and, for an issue that changes a Studio screen, only when the last
`final` has no P0 or P1 (`pm-critique check <id>` passes). `pm-merge <id> --take-main`, then
`pm-check emuforge-<id>`, the whole check, `integration` included. In the whole
check the integration step of the issue branch runs every check of no service and the browser checks of the
services its paths touch, every service's when a shared path changed; the `services` line of `pm-scope` and
`pm-check` names them, and `pm-merge` refuses a record that ran fewer.

When it fails, tell the cause apart first, and act by it (owner, 2026-11-19):

1. A fault of product code: a failed check goes to the unit that owns what failed, by `breakdown.md`. It fixes it
   on its branch, merges `feat/<id>` into its own when `pm-merge` asks, passes its fast check, and is merged again.
   When the fix changed a screen, that screen alone is critiqued once more (`SCORE final <its routes>`), and a P0 or
   P1 it finds is fixed the same way. `feat/<id>` has then moved: run the whole check again.
2. A fault of your own integration test: fix it on `feat/<id>`, have `rev` read the change, and run the whole check
   again.
3. A criteria line that is wrong: stop with `BLOCKED i<id>-plan check <id>`; the `pm` decides.
4. A flaky step: `pm-check` runs a failed test step once more itself; a second run that passes records the step
   `flaky`, writes the flake's line in `.pm/run/flakes.jsonl` and holds nothing up. A step that fails twice is a
   failure: tell its cause apart as here.
5. The environment, as the emulator's image: stop with `BLOCKED i<id>-plan depends <what>` (`depends emulator image`
   for the image) to the `pm`.
6. A fault of `main` outside the issue: file it as its own issue first (below), then take `main`
   (`pm-merge <id> --take-main`) once its fix is there, and run the whole check again.

Never run the whole check again without the cause of its failure written in `state-plan.md`.

## End review

1. When the whole check passes: `REVIEW impl r1 <changed paths> emuforge-<id>/output/checks/last.json` to `rev`: the
   whole diff `main...feat/<id>`, and whether the integration tests are the scenarios.
2. A P1 of the review is fixed by the worker that owns it: fast check, merged again, and the whole check again (a
   fix that changes a screen has that screen critiqued once more first); then the next review round follows.
3. When the review passes: Close, and your `ISSUE READY`.

## What becomes its own issue

You decide first, by a finding's size and whether it is the issue's own. A P2 or P3 of the critique or of the
review, and a fault outside the issue, may become an issue of its own: file it with
`pm-issue new --source plan --severity <S> … --in emuforge-<id>` and `pm-issue commit --in emuforge-<id>`, with the
severity you give it; it reaches `main` with the issue. A P2 or P3 you neither fix nor file is recorded under
`## Review decisions` with one reason. A small fault inside the issue is fixed in it. A P0 or P1 of the critique is
always fixed in the issue, never filed. The `pm` reviews the severity of each issue you filed at the close and may
change it.

## Close

Write `.pm/issue-<id>/report.md`:

- the tasks built;
- the scenarios, which became integration tests, which were left out and why;
- the record `feat/<id>` passed on, with its path;
- the review rounds;
- the critique's findings;
- every issue you filed, with the severity you gave it and one line of reason;
- what was not done.

The `pm` reviews those severities and may change them. Close your workers, `rev` and `crit`
(`pm-pane close <name>`). Then
`pm-report "ISSUE READY i<id>-plan feat/<id> report=.pm/issue-<id>/report.md [filed #<n> …]"`, print the same
line and stop. The `pm` merges `feat/<id>` into `main` and then closes you.

## Events that reach you

The events of your issue's panes come to you as prompts starting with `EVENT`. Your own lines, a dialog in one of
your panes (`EVENT blocked`), a pane's `BLOCKED … memory`, `cpu` or `depends emulator image`, and the machine's
events go to the `pm`.

| line | you do |
|---|---|
| `EVENT ready <worker> UNIT READY <branch>` | Build step 3 |
| `EVENT ready <pane> DONE <what>` | an order you sent finished: note it in `state-plan.md` |
| `EVENT ready <pane> STAGE READY …` | `crit` recorded its scores: read the review file's header, go on |
| `EVENT ready <pane> BLOCKED decision-needed …` | decide from `decisions.md` and the references, record it under `## Plan decisions` and answer the pane in one line; a question only the owner can answer goes to the `pm` as your own `BLOCKED i<id>-plan decision-needed …` |
| `EVENT ready <pane> BLOCKED depends <unit> <what>` | answer in one line, or tell the pane to wait for the parent's `UNIT READY` |
| `EVENT ready <pane> BLOCKED check <id>` | a worker believes a confirmed check is wrong: a wrong criteria line is changed only on the `pm`'s decision, so stop with `BLOCKED i<id>-plan check <id>`; an integration test of yours that does not do what its criteria line says you fix yourself, and record why under `## Plan decisions` |
| `EVENT ready <pane> BLOCKED review <stage>` | three rounds failed: stop with `BLOCKED i<id>-plan review <stage>` |
| `EVENT ctx <pane> <n>K` | read the pane's state file first (a worker's `output/state.md` in its worktree, `state-rev.md` or `state-crit.md`); when it is behind what the pane last reported, tell the pane in one line to write it, and reset on its next turn; then `pm-pane reset <pane>` with the command timeout set to 10 minutes |
| `EVENT silent <pane>` | its turn ended with no typed line: `herdr agent read <pane> --lines 80` and its state file; stopped mid-work, prompt it in one line to go on; finished or waiting, prompt it to end its turn with its typed line (`pane-mode.md`, Reporting lines); silent twice in a row with no progress, `pm-pane reset <pane>` |
| `EVENT stale <pane>` | `herdr agent read <pane> --lines 80`; if it loops, `pm-pane reset <pane>` |
| `EVENT gone <pane>` | reopen it with the same brief; its worktree and state file are still there |
| `EVENT check still <worktree> <step> <n>m` | read the end of `<worktree>/output/logs/check-<step>.log`; a step that still writes is left alone; a hung one: `pm-check <worktree> --stop` and tell its pane in one line |
| `EVENT room <you> pane <role> <side>` | run the `pm-pane new` that was answered `QUEUE` again |
| `EVENT room <you> check <worktree>` | run the `pm-check` that was answered `WAIT` again |

`REVIEWED` lines come straight from `rev` as your next prompt; `WAITING`, `REVIEWED` and `RESET READY` lines are
logged and never delivered. Talk to your panes with
`herdr agent prompt <pane> "<one line>"`.

`EVENT orphans` is the machine's and goes to the `pm`, which prompts the pane or sweeps. Your `pm-pane reset` and
`close` sweep the pane's worktree and print one line: what they stopped, and after `left running:` what they left
because a running check of that worktree started it or a live crit of your issue serves the critique with it.
Before you act on that line, look at it: a process left running is not yours to stop.
