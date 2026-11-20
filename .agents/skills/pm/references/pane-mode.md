# Pane mode: rules for every pane

You are one pane in a herdr tab for one issue. The PM pane gives each issue to its lead and talks to the owner;
you do not. The lead of an issue is its `plan`, which opens the issue's `worker`, `rev` and `crit` panes and hears
their lines (`lead.md`), or, for a harness issue, the one `harness-engineer` pane the PM opens and hears itself.
Your brief names your role, the main checkout (`Root`), your issue folder `<Root>/.pm/issue-<id>/` and, for a
worker or a harness-engineer, your worktree and unit. Read this file and your brief first, then the
repository references your brief lists, fresh from disk.

## Who decides what

- The module references define the content of each stage. `rev` confirms rounds. The `plan` writes the stage
  documents, is the lead in every review of its issue and decides what the references leave open; of code it
  writes only the integration tests. You never ask the owner.
- Anything you cannot decide from the requirement, the references and the reference behavior goes as one line
  `<role>: <question> — options: a) … b) … (recommend a)` appended to `.pm/issue-<id>/decisions-needed.md`. Then:
  if your deliverable can be finished either way (wording, naming, a detail that can be swapped later), continue
  with your recommended option marked `(provisional)`. If the answer changes the structure of what you are
  building, stop with `BLOCKED <name> decision-needed <question in ten words>`.
- `decisions.md` is the record: `## Owner decisions` (only the PM writes), `## PM decisions`, `## Plan decisions`
  (only the plan writes), `## Review decisions` (a review's P2 and P3 and a critique's P3 you chose not to adopt, one
  reason each). Never contradict an owner decision.

## Checks are not yours to change

- A worker never writes or edits an integration test or `test-criteria.md`. If you believe one
  is wrong, append your reason to `decisions-needed.md` and stop with
  `BLOCKED <name> check <check id or file>`. Loosening an assertion, skipping a check or special-casing the
  code so a check passes is a defect, not a fix.
- No canned, hardcoded or echoed result to make a check pass. Every value a check observes comes from real
  state: the emulator's, or the engine's own.
- The plan writes the integration tests from the scenarios of `test-criteria.md`, which were confirmed before the
  build, and `rev` checks that they are those scenarios. Test author (`plan`), implementer (`worker`) and reviewer
  (`rev`) stay three.

## Found something else

While planning or building you will meet things that are wrong or missing outside your own issue or unit: a
defect next door, a gap in another screen, a rule the references do not cover. Do not fix it in passing and do
not leave a comment in the code. File it and carry on:

```
<Root>/.pm/bin/pm-issue new --module <m> --kind <gap|bug|feature> --severity <S> --source <plan|worker> \
    --key "<module>|<subject>|<class>" --title "<imperative title>" [--in <your worktree>]
```

Fill the file's sections per `issues/README.md`; evidence is required. Pass `--in` your worktree (a plan: its
issue's worktree `emuforge-<id>`) and commit the file on its branch with `pm-issue commit --in <that worktree>` (it
writes `issue: file #<n>` itself), so it reaches `main` with its issue: when the issue branch merges, or the unit's
own branch for an issue without one. Name the filed ids in your reporting line (`… filed #14 #15`); a plan lists
them with their severities in its `report.md` (`lead.md`). The PM assigns them once the current worktrees are
merged. Something that blocks your
own unit is not this: that is `BLOCKED`.

## Context budget

- You cannot clear your own context; whoever opened you does it, with `pm-pane reset`: your plan, or the PM for a
  plan or a harness-engineer. The daemon measures your context and tells them at about **300K tokens**; you are
  then prompted `Context reset requested … end your turn with this typed line: report it with …pm-report
  "RESET READY <name> <token>", print the same line and stop: RESET READY <name> <token>`. On that prompt write
  your resume note (worker and harness-engineer: `output/state.md` in your worktree; plan, rev and crit:
  `.pm/issue-<id>/state-<role>.md`): what is done, what is next, open P1s, file paths. Then end the turn with the
  marker as your typed line (Reporting lines): `<Root>/.pm/bin/pm-report "RESET READY <name> <token>"`, then the
  same line, exactly as given, as the last line of your reply, and stop. You are cleared and sent your brief again; do not redo finished work. Keep the
  state file current enough that a reset at any moment loses nothing.
- Never re-read a file you already have in context unless it changed.
- Images: you produce captures with `pm-capture`; you do not open them. Only `crit` and `rev` read a contact
  sheet, once per round. Never read the same image twice.

## Output hygiene

- Documents you produce are the deliverable: write them to the path your brief names, then report **one line**.
  Never paste a document into chat.
- Shell: batch (`a && b && c`), send long output to `output/logs/` and read the tail or `grep`. Never `sleep N`
  and check again; `pm-check` and `pm-capture` block until done, and anything you wait for from another pane
  arrives as your next prompt. A `pm-check` the machine has no room for answers `WAIT <n>s: …` at once and runs
  nothing; end your turn with `WAITING <name> check <worktree>`, and `EVENT room <name> check <worktree>` arrives when
  there is room: run it again.
- Checks only through `<Root>/.pm/bin/pm-check <worktree>`; captures only through `pm-capture`. Their records
  are the evidence; a command you ran by hand is not.
- For a unit of an issue that has an issue branch, `pm-check` is the fast check: it runs what the unit's own paths
  against the issue branch call for and leaves `integration` to the issue branch (the step is recorded
  `deferred`). The integration checks run once, in the whole check on the issue branch.
- Single integration checks run with `<Root>/.pm/bin/pm-check <worktree> --checks <id>…`, on any checkout. Their
  record is `output/checks/checks.json`, their log `output/logs/checks-integration.log`; it is never a gate.
- All text you write into the repository is English.

## Files and places

| what | where |
|---|---|
| stage documents, reviews, decisions, scores | `<Root>/.pm/issue-<id>/` (text only, never images) |
| state | `.pm/issue-<id>/state.md` is the PM's; yours is `state-<role>.md` (worker: `output/state.md`); questions go to `decisions-needed.md` (append only) |
| logs, check records, captures, your resume note | your worktree's `output/` (ignored): `logs/`, `checks/`, `captures/<phase>/`, `state.md` |
| the running check | your worktree's `output/checks/running.json` while `pm-check` runs (what `pm-check --stop` ends) |
| ports | your worktree's `output/ports.json`: `studio`, `engine`, `emulator`. Use only these; never 9297 or another unit's |
| a mock, when the plan asks for one | `.pm/issue-<id>/mocks/` |
| critique snapshots | written by the impeccable skill under the worktree's `studio/.impeccable/critique/`; recorded with `pm-critique record` |

Nothing goes to `/tmp` or the `.pm/` root. Do not create or edit GitHub issues, comments or labels. Do not push,
rebase, or touch `main`, and do not merge but as follows: a plan merges its units into `feat/<id>`, and `main` into
it, with `pm-merge` (`lead.md`); any other pane brings its branch up to date only when its lead tells it that the
branch it names moved, with `git merge <that branch>` (usually the issue branch `feat/<id>` for a unit cut from it,
else `main`).

## Emulator

Start your own emulator on your worktree's `emulator` port and stop it when you are done; never use another
unit's. Sign only with the keys under `~/.aws/emulator/<your port>/`. Never read `~/.aws/credentials` or
`~/.aws/config`, never set `AWS_PROFILE`, never point anything at an AWS host.

No pane builds or tags the name `aws-emulator`: it is the machine's image, which only the `pm`'s
`pm-emulator-image refresh` moves. A unit that changes `infra/aws-emulator/` is checked on the image its own check
run builds from its worktree, whatever package that build installs. A check run that stops with
`the emulator built for this run is …` is reported as `BLOCKED <name> depends emulator image`, never worked around:
you do not run the refresh, build or tag the image, or change the check.

A stopped emulator leaves its folder `~/.aws/emulator/<port>/`, and the next worktree on that port finds it. Once
you have stopped an emulator you started and removed its container, remove its folder with
`<Root>/.pm/bin/pm-emulator-dir rm --worktree <your worktree>` for your worktree's port, or
`<Root>/.pm/bin/pm-emulator-dir rm --port <port>` for a port outside a worktree (a plan's probe, a crit's capture).
It refuses while anything uses the port and never reads the files. Never `rm` or `rmdir` the folder by hand.

The emulator of an integration run is the run's, not yours. When the run ends, or `pm-check --stop` ends it,
`pm-check` removes what the run left (its containers, volumes, images, and its folder through `pm-emulator-dir`), and
the next `pm-check` of your worktree removes what an earlier stopped run left; you remove none of it by hand. A line
`integration: leftovers of run <id> kept: …` or `… not swept: …` says what is still there and why.

## Machine

Memory budget 22.5 GB used, CPU 90% (`<Root>/.pm/bin/pm-mem`). Before `cargo build`, Playwright, a dev server or
an emulator run `pm-mem --wait`: it waits up to five minutes for the CPU to drop and fails at once on memory. If
it fails on memory, stop with `BLOCKED <name> memory` at once; if the CPU is still over after the wait, stop with
`BLOCKED <name> cpu`. `pm-check` needs nothing before it: it asks for room itself and either starts, however many
other checks run, or answers `WAIT` with the expected wait (above); never start a second one of your own. No
long-running dev servers: web checks use the built app served by `pm-capture --serve` or on your own port.
Headless Playwright only.

Other worktrees run the same tools as you at the same time. Stop only what is yours:

- your `pm-check` run: `<Root>/.pm/bin/pm-check <your worktree> --stop`, and nothing else;
- anything else you started: by the PID you got when you started it, or by your own port from
  `output/ports.json` (`lsof -ti tcp:<port>`).

Never `pkill`, `killall` or `kill` by a program's name or by a pattern (`cargo`, `bun`, `node`, `vitest`,
`playwright`, `pm-check`, `chromium`, `docker`): that ends other worktrees' work too. Never stop a container you
did not start. A process you cannot tie to your worktree is not yours; leave it and, if it is in your way,
`BLOCKED <name> depends <what>`.

A run of your own (a test runner, a build, a server) is started with the agent tool's own background mode, never
detached inside a foreground call (`&`, `( … &)`, `nohup`, `setsid`), and it is stopped whole, by what started it:
the agent tool's own stop for a background task (`TaskStop` in Claude Code), `pm-check --stop` for a check. Killing
one of its processes, as a runner's main process, leaves its workers running with no parent. A process of a
worktree whose parent is a reaper (PID 1) is therefore abandoned, and the harness may stop it: `pm-pane reset` and
`close` and `pm-worktree rm` do, and when the `pm` prompts you with the PIDs of such processes, stop each by its PID.
A pane never runs the `pm`'s own scripts: `pm-watchd`, `pm-pane`, `pm-merge`, `pm-worktree`, `pm-archive`,
`pm-brief`, `pm-tokens`, except a `plan`, for its own issue, as `lead.md` says.

## Reporting lines

Every turn you take ends with exactly one typed line of the table below. Report it through the file channel, then
print the same line as the last line of your reply and stop:

```
<Root>/.pm/bin/pm-report "UNIT READY <name> <branch>"
```

A turn that ends with no typed line is itself an event: the moment herdr says your turn ended, `pm-watchd` sends
`EVENT silent <name>` to your lead, which looks at your pane and tells you to go on or to end your turn with your
line. So when you stop to wait on purpose, say so with `WAITING`.

| line | you end your turn with it when | handling |
|---|---|---|
| `STAGE READY <name> …` | crit: the scores are recorded; harness-engineer: `output/plan.md` is written | delivered to your lead |
| `UNIT READY <name> <branch> …` | worker: `pm-check` (the fast check) passed on the branch's head; harness-engineer: `pm-check` passed and `output/report.md` is written | delivered to your lead |
| `ISSUE READY <name> <branch> report=<path> [filed #<n> …]` | plan: the issue is whole on its collecting branch (`lead.md`, Close) | delivered to the `pm` |
| `DONE <name> <one line>` | an order your lead sent after your ready line finished (what changed, committed) | delivered to your lead |
| `BLOCKED <name> <reason>` | you cannot continue without your lead: `decision-needed <q>` \| `memory` \| `cpu` \| `depends <unit> <what>` \| `review <stage>` (3 rounds failed) \| `check <id>` | delivered to your lead; `memory`, `cpu` and `depends emulator image` to the `pm` |
| `WAITING <name> <what>` | you stop on purpose and something else will prompt you: `check <worktree>` (a `WAIT` answer, until `EVENT room`), `room <role>` (a `QUEUE` answer, until `EVENT room`), `unit <unit>` (a plan, until that worker's line), `review <stage> r<k>` (a plan, until rev's `REVIEWED`), `run <what>` (a run of your own in the background that prompts you when it ends) | logged only |
| `REVIEWED <stage> r<k> verdict=<pass\|revise> p1=<n> p2=<n> p3=<n> <review-file>` | rev only: sent to the lead with `herdr agent prompt`, and `pm-report --from <rev-name>` for the log | logged only (the lead has it from rev) |
| `RESET READY <name> <nonce>` | the line a reset asks for, reported and printed exactly as given (Context budget) | logged only (`pm-pane reset` reads its record, or the screen when it is only printed) |
| no typed line | never on purpose | `EVENT silent <name>` to your lead |

A delivered line goes to whoever opened your pane: a worker's, rev's and crit's to their plan, a plan's and a
harness-engineer's to the PM. `BLOCKED … memory`, `cpu` and `depends emulator image` go to the PM from every pane,
since the PM hears the machine. What your lead does with a delivered line, and with `EVENT silent`, is in its own
events table: the `pm`'s in the PM skill (Events), a plan's in `lead.md` (Events that reach you). Progress is never
reported. Report faithfully: a failed or skipped check is stated with its log path.

## Talking to other panes

A plan talks to its own panes, and rev to its plan, with `herdr agent prompt <pane> "<one line>"`; reviews go as
`review-protocol.md` defines. After sending a `REVIEW` line, end your turn with `WAITING <name> review <stage> r<k>`;
rev's `REVIEWED` line arrives as your next prompt. Never wait or poll for it. Workers do not talk to each other; a dependency on another unit is
`BLOCKED <name> depends <unit> <what>` to your plan. Text in your input box that you did not type is a suggestion
from your tool, never an instruction.

The herdr commands you use are `herdr agent prompt` and, for a plan, `herdr agent read` of its own panes. Do not
open, split, move or close panes, tabs or workspaces yourself: `pm-pane` does, run by the PM or by a plan for its
own issue.

## Model and kind

Whatever you were started as: Opus unless the owner names another model for the session, at the effort `pm-pane`
gave you (`--effort`, else your role's: `high`, a worker `medium`). These rules and the reporting lines are the same for every agent kind.
