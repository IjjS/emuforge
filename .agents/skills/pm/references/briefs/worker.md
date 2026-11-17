# Brief: worker pane i{{issue}}-worker-{{unit}}

Role: `worker`. Root: `{{root}}`. Read `{{root}}/.agents/skills/pm/references/pane-mode.md` and
`review-protocol.md` first. Your reviewer is pane `i{{issue}}-rev`. Your cwd is your worktree; every `.pm/` path
below is under `{{root}}/`.

Issue #{{issue}} ({{module}}, {{kind}}): {{title}}. Issue file: `{{issue_file}}`. Unit `{{unit}}`: {{unit_summary}}
Worktree: `{{worktree}}` (branch `{{branch}}` based on `{{base}}`, ports in `output/ports.json`). Edit only there,
only the files `breakdown.md` gives this unit: {{owned_files}} — plus, without asking, any file that stops
compiling because of your own signature change, for that fix alone.
Inputs (read once), in `{{root}}/.pm/issue-{{issue}}/`: `breakdown.md` (your unit), {{inputs}}{{precedents}}.
Conventions: {{conventions}}. Match the sibling files on `main` before writing new ones.

{{work}}

Dependencies on another unit: `BLOCKED i{{issue}}-worker-{{unit}} depends <unit> <what you need>`; never edit
another unit's files. Merge a branch into yours only when the PM names it and tells you it moved: the issue
branch, your base branch or `main`. Keep `output/state.md` current after each step; the PM resets your context
from it past 300K.

<!-- block: tests (unit t<n>) -->
Steps:
1. Write one integration check per `Integration` or `Flow` line of `test-criteria.md`, and nothing the criteria
   do not list, with a `manifest.jsonl` row each. For a studio `console` issue, commit each file under
   `.pm/issue-{{issue}}/specs/` to `studio/references/console/<service>/` unchanged.
2. Run your checks against a fresh emulator with `{{root}}/.pm/bin/pm-check {{worktree}} --checks <id>…`: it
   starts the suite with only those checks and records them in `output/checks/checks.json`, with the log in
   `output/logs/checks-integration.log`; it is never a gate. Every one must fail now, for the reason its
   criteria line names. A check that passes before the implementation exists proves nothing: say so in
   `decisions-needed.md` and stop with `BLOCKED … decision-needed`.
3. Commit in small steps on your branch. `REVIEW checks-{{unit}} r1 <paths> output/checks/checks.json
   output/logs/checks-integration.log` to rev, end your turn; fix P1s when `REVIEWED` arrives; up to three rounds.
4. `{{root}}/.pm/bin/pm-report "UNIT READY i{{issue}}-worker-{{unit}} {{branch}}"`, print the same line, stop.
   When your base is the issue branch, the PM merges your branch into it on your checks review, red or not;
   otherwise a branch that is red by design is not merged by itself and arrives through the unit stacked on it.
   You do not read or touch any implementation branch.

<!-- block: implementation (unit e<n>, s<n>, h<n>) -->
Steps:
1. Implement, with the unit tests `test-criteria.md` lists for your unit. Commit in small steps on your branch
   (the go signal authorized commits on this issue's branches; nothing else).
2. `{{root}}/.pm/bin/pm-check {{worktree}}` until it prints `PASSED`. Never change an integration check, a
   reference spec or the criteria to get there; if one is wrong, `BLOCKED … check <id>`. Studio units also
   capture each changed screen: build, then `{{root}}/.pm/bin/pm-capture {{worktree}} impl --serve studio/dist
   --url <route>…`. You do not look at the captures.
3. {{close_step}}
4. `REVIEW impl-{{unit}} r1 <changed paths> output/checks/last.json` to rev, end your turn; fix P1s when
   `REVIEWED` arrives, run `pm-check` again after every fix; up to three rounds.
5. `{{root}}/.pm/bin/pm-report "UNIT READY i{{issue}}-worker-{{unit}} {{branch}}"`, print the same line, stop.
   Stay open for orders from the PM; only such an order ends with
   `pm-report "DONE i{{issue}}-worker-{{unit}} <what changed, committed>"`. Never report progress.
