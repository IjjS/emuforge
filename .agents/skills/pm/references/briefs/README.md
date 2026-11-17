# Brief placeholders

`.pm/bin/pm-brief` fills a template and writes `.pm/issue-<id>/brief-<role or unit>.md`; the PM never fills one
by hand. Nothing else is added or removed. The table says where each value comes from; `pm-brief` looks up
everything it can and fails when a placeholder would be left unfilled.

| placeholder | value |
|---|---|
| `{{root}}` | absolute path of the main checkout |
| `{{issue}}`, `{{title}}` | `Issue-Id` and the issue file's title |
| `{{issue_file}}` | path of the issue file under `issues/` |
| `{{module}}`, `{{kind}}` | `Issue-Module` and `Issue-Kind` |
| `{{grade}}` | studio only: `console`, `native`, `none`; else empty |
| `{{unit}}`, `{{unit_summary}}`, `{{owned_files}}` | from `breakdown.md` |
| `{{worktree}}`, `{{branch}}`, `{{base}}` | from `pm-worktree new` output; `{{base}}` is the unit's registered base: the issue branch `feat/<id>` for a unit cut from it, the parent unit's branch when stacked, else `main` |
| `{{conventions}}` | `t` unit: `tests/integration/AGENTS.md`. `e` unit: `engine/AGENTS.md, engine/references/security-review.md, relay-fidelity.md`. `s` unit: `studio/AGENTS.md`. `h` unit: `AGENTS.md` |
| `{{inputs}}` | `t` unit: `requirement.md, test-criteria.md` and, for studio `console`, `specs/`. `e` unit: `requirement.md, decisions.md, design.md, test-criteria.md`. `s` unit: `requirement.md, decisions.md, test-criteria.md` and `specs/` or `mocks/` by grade |
| `{{work}}` | `t` unit: the template's `tests` block. Any other unit: the `implementation` block |
| `{{close_step}}` | the unit that closes the issue: `Run {{root}}/.pm/bin/pm-issue close {{issue}} --checks "<ids>" --in {{worktree}} and commit the move with your last commit.` with the check ids filled in (`--close`); else a line saying the unit does not close the issue |
| `{{plan_refs}}` | plan: `AGENTS.md, issues/README.md, tests/integration/AGENTS.md` plus the module's `AGENTS.md` and every file in its `references/` |
| `{{screen_step}}` | plan. engine side: `` `design.md` per engine/references/workflow.md stage 2, with the security review rows for everything the change touches. REVIEW design r1.`` studio `console`: `` one reference spec per screen under specs/ per studio/references/console-reference.md. REVIEW spec r1.`` studio `native`: `` a mock under mocks/ built from the design system of the screen's layer (studio/references/critique.md, native screens), showing the states the requirement names; capture it with pm-capture <root> mock-<id> --file <mock.html>, then stop with BLOCKED i<id>-plan depends crit mock; the PM has crit score it; revise until critique.md's Screen stage passes.`` studio `none`: `(no screen stage for this grade)` |
| `{{refs}}` | rev: `AGENTS.md, issues/README.md` plus the module's `AGENTS.md` and every file in its `references/`, plus `tests/integration/AGENTS.md` |
| `{{precedents}}` | zero to two related archives: `, .pm/archive/<m>.md (precedent)`; else empty |
| `{{targets}}`, `{{capture_wt}}` | crit: the routes to capture, and the worktree that holds every studio unit of the issue |
