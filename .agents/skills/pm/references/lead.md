# Lead: how a plan leads its issue

A `plan` leads one issue from its requirement to its closing report. The `pm` gave it the issue and hears of it
again only through the plan's `BLOCKED` lines and its closing line `ISSUE READY`. Everything in between is the
plan's: the stage documents, the cut into units, the worktrees, briefs and panes of its workers, the merges into the
issue's collecting branch `feat/<id>`, the critique, the implementation review, the integration tests and their
review, and the whole check.

This order applies when `brief.json` has `review_order: split`. An already-briefed issue with `lead: plan` and no
review order finishes under its prior stages. Read the prior version of this file with
`git show c9843ccb:.agents/skills/pm/references/lead.md`.

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

## A review round

A `rev` pane lives for one review round (owner, 2026-11-20; `review-protocol.md`). For each `REVIEW <stage> r<k>`:

1. Open a rev for it, with the round as its first prompt:
   `pm-pane new <id> rev --brief .pm/issue-<id>/brief-rev.md --text "REVIEW <stage> r<k> <paths>"` (pane
   `i<id>-rev`), then end your turn with `WAITING i<id>-plan review <stage> r<k>`. Every round's pane has the same
   brief; `pm-pane` gives it the kind, model and effort the last one had, unless you pass them. A `QUEUE` answer:
   `WAITING i<id>-plan room rev`, and the same command again on `EVENT room`.
2. Its `REVIEWED` line arrives as your next prompt. When `.pm/issue-<id>/review-<stage>-r<k>.md` is there, close the
   pane: `pm-pane close i<id>-rev`. When it is missing, prompt the pane once to write it, and close it after.
3. For the next round, open a new pane. Within a stage, r<k+1> reads r1 to r<k> from their files. Use the next
   number to review a changed submission. `pm-merge` requires each stage's files to span r1 to its last round.

## Stages before the build

Two reviews by `rev` before any code, per `review-protocol.md` (owner, 2026-11-19): the requirement alone, then
the plan set. The module's `references/workflow.md` and `references/test-criteria.md` say what each document holds.

1. `requirement.md`. Find out what the emulator answers today by calling one (start it on a free port, stop it
   after); never from memory. Its round is `REVIEW requirement r1 .pm/issue-<id>/requirement.md` (A review
   round).
2. On its `pass`, the plan set: write its three documents together, then send them in one round,
   `REVIEW plan-set r1 .pm/issue-<id>/design.md .pm/issue-<id>/test-criteria.md .pm/issue-<id>/breakdown.md`. A
   `revise` names the document of each P1: fix those, and send the whole set again as r<k+1>, to a new rev.
   - `design.md`, the design stage your brief names (the module's `references/workflow.md`, stage 2); left out of
     the set when the workflow skips the design for the issue's kind.
   - `test-criteria.md`, from the requirement: per unit, the unit-test scenarios that are its worker's end
     condition; for the issue, the scenarios its integration tests will be. When you can already tell that an
     integration test will be left out (the issue is too slight, or the test would cost more than it shows), say
     so here, with the reason. If the issue will make no integration changes, record the omission before the
     plan set review (Integration tests and review). An environment case (the emulator or the engine stopped,
     killed, restarted, not there, not reachable, or coming up late) is written for the tier `full` and never for
     the push run or the whole check (`tests/integration/AGENTS.md`, Full tier).
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
   `medium`, `rev` and `crit` at `high`, and a pane opened again under its name (a rev for each round) with the
   kind, model and effort it had.
3. On a worker's `UNIT READY`: `pm-merge <id> <unit>` merges its branch into `feat/<id>` on its fast check. A unit
   is merged as many times as it is fixed.
4. After a merge, tell only a pane whose branch was cut from `feat/<id>` and that needs what it gained:
   `herdr agent prompt <pane> "feat/<id> is at <sha>; merge it into your branch"`. Telling every pane makes each
   check again for nothing.

## Critique

An issue that changes a Studio screen is critiqued before the implementation review. When every unit is
merged into `feat/<id>`, each on its fast check, run `pm-brief crit <id> --targets "<routes>" --capture-wt
emuforge-<id>`, then `pm-pane new <id> crit --brief .pm/issue-<id>/brief-crit.md`, and prompt it
`SCORE final <routes>`: the impeccable critique on the built app of `feat/<id>` (`studio/references/critique.md`).
Every P0, P1 and P2 finding goes to the worker that owns the screen; it is fixed, passes its fast check and is
merged, and the screen is critiqued again (owner, 2026-11-20). A P2 whose fix would change the requirement or a
confirmed check, or go against a rule of the area or a decision already made, you do not send to the worker: append
it to `decisions-needed.md` and stop with `BLOCKED i<id>-plan decision-needed critique-p2 <screen> <finding>`. The
`pm` either has it fixed or lets it stand, records why under `## PM decisions` and runs `pm-critique leave`; never
run that yourself. A P3 is yours to adopt or not (What becomes its own issue). The score goes in `report.md` and
decides nothing. Ask `crit` for a mock before the build (`SCORE mock <file>`) only when a screen is new and large
and the build would otherwise be a guess.

## Implementation review

When every unit is merged, take local main with `pm-merge <id> --take-main` before the first `impl` round. For
Studio screen changes, the last `final` must clear `pm-critique check <id>` before the round. If taking main
changed a screen under review, critique it again.

Open `REVIEW impl r1 <implementation diff> <fast-check records>` (A review round). Give rev the issue branch's
product and unit-test changes against its merge base with main, and the fast-check records of the units as
merged. Have the owning workers fix findings on their branches, pass their fast checks and merge again. If a fix
changes a screen, clear its critique before sending the next implementation round. When you adopt a finding
that changes a passing submission, send the revised implementation for its next round too. Start writing the
integration tests once the resulting implementation passes.

## Integration tests and review

Write the integration tests in `emuforge-<id>` on `feat/<id>`, one per integration scenario of
`test-criteria.md`, and commit them with their support and manifest rows as `tests/integration/AGENTS.md` says.
Record the reason for each scenario left out in the criteria when known before the build, and in the closing
report. When you cannot tell whether to leave one out, stop with
`BLOCKED i<id>-plan decision-needed integration <scenario>`.

Run the affected check IDs with `pm-check emuforge-<id> --checks <id>…` before the review. Include IDs exercised
by changed support. Only the owner's request authorizes a local run of a `full`-tier check, including by ID.
Record cases excluded from the run and why. If no affected ID is runnable, give the reviewer that reason with
the integration changes. Handle failures by cause (Whole check) and record the reason before retrying.

Open `REVIEW tests r1 <integration diff> <test-criteria.md> <focused run record>`. Limit the diff to
`tests/integration/` against the branch's merge base with main. Include the record from `output/checks/`
for the submitted tests and cite any omission reasons. Fix adopted findings on `feat/<id>`, run the affected IDs
on the revised tests, and send the next tests round.

To omit this stage, include the line `Integration review: omitted - <reason>` in the pre-build
`test-criteria.md` confirmed in the plan set. The issue branch must have no changes under `tests/integration/`
against its merge base with main and no tests round. The whole check is still required.

## Whole check

After the reviews pass, or after `impl` passes for an issue with the tests stage omitted, run
`pm-check emuforge-<id>`. Finish adopted review fixes and issue-file commits first. The resulting
`output/checks/last.json` must pass on the branch's final head. The focused records show what the named IDs did
on their submitted integration changes. In the whole
check the integration step of the issue branch runs every check of no service and the browser checks of the
services its paths touch, every service's when a shared path changed; the `services` line of `pm-scope` and
`pm-check` names them, and `pm-merge` refuses a record that ran fewer.

When a focused run or the whole check fails, determine its cause before acting (owner, 2026-11-19):

1. A fault of product code: a failed check goes to the unit that owns what failed, by `breakdown.md`. It fixes it
   on its branch, merges `feat/<id>` into its own when `pm-merge` asks, passes its fast check, and is merged again.
   When the fix changed a screen, that screen alone is critiqued once more (`SCORE final <its routes>`), and a P0,
   P1 or P2 it finds is fixed the same way. Renew the `impl` review if its reviewed changes moved, then resume the
   interrupted stage.
2. A fault of your own integration test: fix it on `feat/<id>`, rerun the affected IDs, and send the tests for
   review. When the whole check found the fault, run it again after the tests review passes.
3. A criteria line that is wrong: stop with `BLOCKED i<id>-plan check <id>`; the `pm` decides.
4. A failure that looks intermittent: there is no second run (issue 569), so a step that fails has failed; tell
   its cause apart as here, and file one that is no unit's as its own issue (below).
5. The environment, as the emulator's image: stop with `BLOCKED i<id>-plan depends <what>` (`depends emulator image`
   for the image) to the `pm`.
6. A fault of `main` outside the issue: file it as its own issue first (below), then take `main`
   (`pm-merge <id> --take-main`) once its fix is there, renew any review whose submitted changes moved, and resume
   the interrupted stage.

Write the cause of a failed run in `state-plan.md` before retrying. Renew a review using its next round and the
same scope. If the stage has used three rounds, stop with `BLOCKED i<id>-plan review <stage>`. When the whole
check passes, proceed to Close.

## What becomes its own issue

You decide first, by a finding's size and whether it is the issue's own. A P3 of the critique, a P2 or P3 of the
review, and a fault outside the issue, may become an issue of its own: file it with
`pm-issue new --source plan --severity <S> … --in emuforge-<id>` and `pm-issue commit --in emuforge-<id>`, with the
severity you give it; it reaches `main` with the issue. Such a P2 or P3 you neither fix nor file is recorded under
`## Review decisions` with one reason. A small fault inside the issue is fixed in it. A P0, P1 or P2 of the critique
is always fixed in the issue, never filed, but for a P2 the `pm` let stand (Critique). The `pm` reviews the severity of each issue you filed at the close and may
change it.

## Close

Write `.pm/issue-<id>/report.md`:

- the tasks built;
- the scenarios, which became integration tests, which were left out and why;
- the record `feat/<id>` passed on, with its path;
- the review rounds, including `impl` and `tests` or the reason the tests stage was omitted;
- the critique's findings: the P0, P1 and P2 fixed, each P2 the `pm` let stand with its decision, and the P3 with
  what became of each;
- every issue you filed, with the severity you gave it and one line of reason;
- what was not done.

The `pm` reviews those severities and may change them. Close your workers and `crit` (`pm-pane close <name>`);
no rev is open by then, each was closed after its round. Then
`pm-report "ISSUE READY i<id>-plan feat/<id> report=.pm/issue-<id>/report.md [filed #<n> …]"`, print the same
line and stop. The `pm` merges `feat/<id>` into `main` and then closes you.

`pm-merge` takes `feat/<id>` into `main` on the whole check's record when git merges it with no conflict, however
far `main` moved since. On a conflict, use `pm-merge <id> --take-main` to identify the paths. For a unit's paths,
have the owner merge `main` into its branch, resolve the conflict, pass its fast check and merge into the issue
branch. For conflicting integration paths you own, save the issue's changes to those paths, commit their
versions from `main`, take main with `--take-main` and reapply the changes on the updated base. Clear any affected
screen critique and renew each review whose submitted changes moved. For a changed integration submission, run
its affected IDs before the new review round. Run the whole check on the new head and send `ISSUE READY` again.

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
| `EVENT ctx <pane> <n>K` | read the pane's state file first (a worker's `output/state.md` in its worktree, or `state-crit.md`; a rev keeps none, the reset asks it for its round in progress); when it is behind what the pane last reported, tell the pane in one line to write it, and reset on its next turn; then `pm-pane reset <pane>` with the command timeout set to 10 minutes |
| `EVENT silent <pane>` | its turn ended with no typed line: `herdr agent read <pane> --lines 80` and its state file; stopped mid-work, prompt it in one line to go on; finished or waiting, prompt it to end its turn with its typed line (`pane-mode.md`, Reporting lines); silent twice in a row with no progress, `pm-pane reset <pane>` |
| `EVENT stale <pane>` | `herdr agent read <pane> --lines 80`; if it loops, `pm-pane reset <pane>` |
| `EVENT gone <pane>` | reopen it with the same brief; its worktree and state file are still there; a rev, with the same round |
| `EVENT check still <worktree> <step> <n>m` | read the end of `<worktree>/output/logs/check-<step>.log`; a step that still writes is left alone; a hung one: `pm-check <worktree> --stop` and tell its pane in one line |
| `EVENT room <you> pane <role> <side>` | run the `pm-pane new` that was answered `QUEUE` again |
| `EVENT room <you> check <worktree>` | run the `pm-check` that was answered `WAIT` again |

`REVIEWED` lines come straight from `rev` as your next prompt (A review round, step 2); `WAITING`, `REVIEWED` and `RESET READY` lines are
logged and never delivered. Talk to your panes with
`herdr agent prompt <pane> "<one line>"`.

`EVENT orphans` is the machine's and goes to the `pm`, which prompts the pane or sweeps. Your `pm-pane reset` and
`close` sweep the pane's worktree and print one line: what they stopped, and after `left running:` what they left
because a running check of that worktree started it or a live crit of your issue serves the critique with it.
Before you act on that line, look at it: a process left running is not yours to stop.
