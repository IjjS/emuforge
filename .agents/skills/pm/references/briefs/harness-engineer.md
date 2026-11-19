# Brief: harness-engineer pane i{{issue}}-harness-engineer

Role: `harness-engineer`. Root: `{{root}}`. Read `{{root}}/.agents/skills/pm/references/pane-mode.md` first. You
plan and implement this harness work alone; the `pm` reads your plan, your report and your change and judges them.
There is no plan, rev or crit pane for it, so what pane-mode says of them does not apply to you. Your cwd is your
worktree; every `.pm/` path below is under `{{root}}/`.

Issue #{{issue}} ({{module}}, {{kind}}): {{title}}. Issue file: `{{issue_file}}`. This pane's part: {{part}}
Worktree: `{{worktree}}` (branch `{{branch}}` based on `{{base}}`, ports in `output/ports.json`). Edit only there.
Requirement: the issue file and `{{root}}/.pm/issue-{{issue}}/decisions.md`{{precedents}}. Conventions: `AGENTS.md`.

Steps:
1. Plan in `output/plan.md`: what changes in which file, what you leave, and each question for the `pm` with its
   options, your recommendation first. Then `{{root}}/.pm/bin/pm-report "STAGE READY i{{issue}}-harness-engineer
   plan output/plan.md"`, print the same line and stop. The `pm` answers once; build on that answer.
2. Build, committing in small steps. Add no test: the harness keeps only the guards of `.pm/bin/tests/test_guards.py`
   (issue 523). A new guard is written only on the `pm`'s decision, recorded in `decisions.md`, for a new way a
   script could delete, stop or remove what is not its own, and the guards stay under 30 s in all.
3. {{close_step}}
4. `{{root}}/.pm/bin/pm-check {{worktree}}` until it prints `PASSED`. On a harness change it runs the harness
   guards and nothing else; run nothing else. A `WAIT` answer: end
   your turn until `EVENT room`.
5. Write `output/report.md`: the commit, the files changed, what ran (with the record's path), and what the `pm`
   should look at first. Then `{{root}}/.pm/bin/pm-report "UNIT READY i{{issue}}-harness-engineer {{branch}}
   report=output/report.md"`, print the same line and stop. Stay open for the `pm`'s orders; one ends with
   `pm-report "DONE i{{issue}}-harness-engineer <what changed, committed>"`. Never report progress.

Merge a branch into yours only when the `pm` names it and tells you it moved. Keep `output/state.md` current after
each step; the `pm` resets your context from it past 300K.
