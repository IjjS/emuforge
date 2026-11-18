# Brief: worker pane i{{issue}}-worker-{{unit}}

Role: `worker`. Root: `{{root}}`. Read `{{root}}/.agents/skills/pm/references/pane-mode.md` first. Your plan is pane
`i{{issue}}-plan`: it opened you, hears your reporting lines and sends you its orders. Your cwd is your worktree;
every `.pm/` path below is under `{{root}}/`.

Issue #{{issue}} ({{module}}, {{kind}}): {{title}}. Issue file: `{{issue_file}}`. Unit `{{unit}}`: {{unit_summary}}
Worktree: `{{worktree}}` (branch `{{branch}}` based on `{{base}}`, ports in `output/ports.json`). Edit only there,
only the files `breakdown.md` gives this unit: {{owned_files}} — plus, without asking, any file that stops
compiling because of your own signature change, for that fix alone.
Inputs (read once), in `{{root}}/.pm/issue-{{issue}}/`: `breakdown.md` (your unit), {{inputs}}{{precedents}}.
Conventions: {{conventions}}. Match the sibling files on `main` before writing new ones.
End condition: {{scenarios}}. Each is a unit test of yours, and every one passes.

Steps:
1. Implement, with a unit test for each scenario of your end condition. You write no integration test: those are
   the plan's. Commit in small steps on your branch (the go signal authorized commits on this issue's branches;
   nothing else).
2. `{{root}}/.pm/bin/pm-check {{worktree}}` until it prints `PASSED`: your fast check, which leaves `integration`
   to the issue branch. Never change an integration test, a reference spec or the criteria to get there; if one
   is wrong, `BLOCKED … check <id>`. Studio units also capture each changed screen: build, then
   `{{root}}/.pm/bin/pm-capture {{worktree}} impl --serve studio/dist --url <route>…`. You do not look at the
   captures.
3. {{close_step}}
4. `{{root}}/.pm/bin/pm-report "UNIT READY i{{issue}}-worker-{{unit}} {{branch}}"`, print the same line, stop.
   Stay open for your plan's orders. An order to fix ends like step 4, after `pm-check` passes again; any other
   order ends with `pm-report "DONE i{{issue}}-worker-{{unit}} <what changed, committed>"`. Never report progress.

Dependencies on another unit: `BLOCKED i{{issue}}-worker-{{unit}} depends <unit> <what you need>`; never edit
another unit's files. Merge a branch into yours only when your plan names it and tells you it moved: the issue
branch, your base branch or `main`. Keep `output/state.md` current after each step; your plan resets your context
from it past 300K.
