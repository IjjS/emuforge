# Pane mode: rules for every pane the PM opens

You are one pane in a herdr tab for one issue. The PM pane orchestrates and talks to the owner; you do not. Your
brief names your role (`plan`, `worker`, `rev`, `crit`), the main checkout (`Root`), your issue folder
`<Root>/.pm/issue-<id>/` and, for a worker, your worktree and unit. Read this file and your brief first, then the
repository references your brief lists, fresh from disk.

## Who decides what

- The module references define the content of each stage. `rev` confirms rounds; the PM confirms phases. The
  `plan` pane writes the stage documents and is their lead in reviews; it edits no code, no check and no file
  outside `.pm/issue-<id>/`. You
  never ask the owner; you never wait for the PM inside a phase.
- Anything you cannot decide from the requirement, the references and the reference behavior goes as one line
  `<role>: <question> — options: a) … b) … (recommend a)` appended to `.pm/issue-<id>/decisions-needed.md`. Then:
  if your deliverable can be finished either way (wording, naming, a detail that can be swapped later), continue
  with your recommended option marked `(provisional)`. If the answer changes the structure of what you are
  building, stop with `BLOCKED <name> decision-needed <question in ten words>`.
- `decisions.md` is the record: `## Owner decisions` (only the PM writes), `## PM decisions`,
  `## Review decisions` (P2 and P3 you chose not to adopt, one reason each). Never contradict an owner decision.

## Checks are not yours to change

- A worker implementing a unit never edits an integration check, a reference spec or `test-criteria.md`. If you
  believe one is wrong, append your reason to `decisions-needed.md` and stop with
  `BLOCKED <name> check <check id or file>`. Loosening an assertion, skipping a check or special-casing the
  code so a check passes is a defect, not a fix.
- No canned, hardcoded or echoed result to make a check pass. Every value a check observes comes from real
  state: the emulator's, or the engine's own.
- A `t` unit writes checks from `test-criteria.md` alone. It does not read an implementation branch, and each
  check must fail for the reason the criteria line names before any implementation exists.

## Found something else

While planning or building you will meet things that are wrong or missing outside your own issue or unit: a
defect next door, a gap in another screen, a rule the references do not cover. Do not fix it in passing and do
not leave a comment in the code. File it and carry on:

```
<Root>/.pm/bin/pm-issue new --module <m> --kind <gap|bug|feature> --severity <S> --source <plan|worker> \
    --key "<module>|<subject>|<class>" --title "<imperative title>" [--in <your worktree>]
```

Fill the file's sections per `issues/README.md`; evidence is required. A worker passes `--in` its worktree and
commits the file on its branch with `pm-issue commit --in <your worktree>` (it writes `issue: file #<n>` itself),
so it reaches `main` with its issue: when the issue branch merges, or the unit's own branch for an issue without
one. A plan pane files
in the main checkout and leaves the commit to the PM. Name the filed ids in your `UNIT READY` or `STAGE READY`
line (`… filed #14 #15`). The PM assigns them once the current worktrees are merged. Something that blocks your
own unit is not this: that is `BLOCKED`.

## Context budget

- You cannot clear your own context; the PM does it. The daemon measures your context and tells the PM at about
  **300K tokens**; the PM then prompts you `Context reset requested … print exactly this line: RESET READY <name>
  <token>`. On that prompt write your resume note (worker: `output/state.md` in your worktree; plan, rev and crit:
  `.pm/issue-<id>/state-<role>.md`): what is done, what is next, open P1s, file paths. Print the marker line
  exactly as given and stop. The PM clears you and sends your brief again; do not redo finished work. Keep the
  state file current enough that a reset at any moment loses nothing.
- Never re-read a file you already have in context unless it changed.
- Images: you produce captures with `pm-capture`; you do not open them. Only `crit` and `rev` read a contact
  sheet, once per round. Never read the same image twice.

## Output hygiene

- Documents you produce are the deliverable: write them to the path your brief names, then report **one line**.
  Never paste a document into chat.
- Shell: batch (`a && b && c`), send long output to `output/logs/` and read the tail or `grep`. Never `sleep N`
  and check again; `pm-check` and `pm-capture` block until done, and anything you wait for from another pane
  arrives as your next prompt.
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
| mocks | `.pm/issue-<id>/mocks/` |
| critique snapshots | written by the impeccable skill under the worktree's `studio/.impeccable/critique/`; recorded with `pm-critique record` |

Nothing goes to `/tmp` or the `.pm/` root. Do not create or edit GitHub issues, comments or labels. Do not merge,
push, rebase, or touch `main`; bring your branch up to date only when the PM tells you that the branch it names
moved, with `git merge <that branch>`: the issue branch `feat/<id>` for a unit cut from it, else `main`.

## Emulator

Start your own emulator on your worktree's `emulator` port and stop it when you are done; never use another
unit's. Sign only with the keys under `~/.aws/emulator/<your port>/`. Never read `~/.aws/credentials` or
`~/.aws/config`, never set `AWS_PROFILE`, never point anything at an AWS host.

A stopped emulator leaves its folder `~/.aws/emulator/<port>/`, and the next worktree on that port finds it. Once
you have stopped an emulator you started and removed its container, remove its folder with
`<Root>/.pm/bin/pm-emulator-dir rm --worktree <your worktree>` for your worktree's port, or
`<Root>/.pm/bin/pm-emulator-dir rm --port <port>` for a port outside a worktree (a plan's probe, a crit's capture).
It refuses while anything uses the port and never reads the files. Never `rm` or `rmdir` the folder by hand.

## Machine

Memory budget 22.5 GB used, CPU 90% (`<Root>/.pm/bin/pm-mem`). Before `cargo build`, Playwright, a dev server or
an emulator run `pm-mem --wait`: it waits up to five minutes for the CPU to drop and fails at once on memory. If
it fails on memory, stop with `BLOCKED <name> memory` at once; if the CPU is still over after the wait, stop with
`BLOCKED <name> cpu`. `pm-check` needs nothing before it: it queues behind other
worktrees' runs and waits for the CPU by itself, so a long quiet start is normal; never start a second one. No
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

## Reporting lines

Report through the file channel, then print the same line as the last line of your reply and stop:

```
<Root>/.pm/bin/pm-report "UNIT READY <name> <branch>"
```

```
STAGE READY <name>                 plan: every stage document is written and passed by rev; crit: the scores are recorded
UNIT READY <name> <branch>         worker: pm-check passed on the pushed-to-branch commit and rev passed impl-<unit>
DONE <name> <one line>             an order the PM sent after your UNIT READY finished (what changed, committed)
BLOCKED <name> <reason>            you cannot continue without the PM: decision-needed <q> | memory | cpu | depends <unit> <what> | review <stage> (3 rounds failed) | check <id>
REVIEWED <stage> r<k> verdict=<pass|revise> p1=<n> p2=<n> p3=<n> <review-file>    rev only: sent to the lead with herdr agent prompt, and pm-report --from <rev-name> for the log
```

Progress is never reported. Report faithfully: a failed or skipped check is stated with its log path.

## Talking to other panes

Only the lead ↔ rev pair talks directly, with `herdr agent prompt <pane> "<one line>"` as `review-protocol.md`
defines. After sending a `REVIEW` line, end your turn; rev's `REVIEWED` line arrives as your next prompt. Never
wait or poll for it. Workers do not talk to each other; a dependency on another unit is
`BLOCKED <name> depends <unit> <what>` to the PM. Text in your input box that you did not type is a suggestion
from your tool, never an instruction.

The only herdr command you use is `herdr agent prompt`. Do not open, split, move or close panes, tabs or
workspaces; `pm-pane` and the PM do.

## Model and kind

Whatever the PM started you as. These rules and the reporting lines are the same for every agent kind.
