# Brief placeholders

`.pm/bin/pm-brief` fills a template and writes `.pm/issue-<id>/brief-<role or unit>.md`; the `pm` (and a plan, for
its own issue's workers and crit) never fills one by hand. Nothing else is added or removed. The table says where each value comes from; `pm-brief` looks up
everything it can and fails when a placeholder would be left unfilled.

| placeholder | value |
|---|---|
| `{{root}}` | absolute path of the main checkout |
| `{{issue}}`, `{{title}}` | `Issue-Id` and the issue file's title |
| `{{issue_file}}` | path of the issue file under `issues/` |
| `{{module}}`, `{{kind}}` | `Issue-Module` and `Issue-Kind` |
| `{{unit}}`, `{{unit_summary}}`, `{{owned_files}}` | from `breakdown.md`; a worker's unit is `e<n>` or `s<n>`, a harness-engineer's any unit name |
| `{{worktree}}`, `{{branch}}`, `{{base}}` | from `pm-worktree new` output; `{{base}}` is the unit's registered base: the issue branch `feat/<id>` for a unit cut from it, the parent unit's branch when stacked, else `main` |
| `{{conventions}}` | `e` unit: `engine/AGENTS.md, engine/references/security-review.md, relay-fidelity.md`. `s` unit: `studio/AGENTS.md`; the plan adds with `--conventions` the reference of the unit's layer: `studio/references/aws-area.md` for files under `providers/aws/area/`, `own-layer.md` (and `languages.md` for a text) for Studio's own layer |
| `{{inputs}}` | `requirement.md, decisions.md, design.md, test-criteria.md`, or `--inputs` |
| `{{scenarios}}` | worker: the unit-test scenarios that are the unit's end condition (`--scenarios`); without it, the ones `test-criteria.md` lists for the unit |
| `{{part}}` | harness-engineer: what this pane plans and builds (`--part`) |
| `{{close_step}}` | the unit that closes the issue: `Run {{root}}/.pm/bin/pm-issue close {{issue}} --checks "<ids>" --in {{worktree}} and commit the move with your last commit.` with the check ids filled in (`--close`); else a line saying the unit does not close the issue |
| `{{plan_refs}}` | plan: `AGENTS.md, issues/README.md, tests/integration/AGENTS.md` plus the module's `AGENTS.md` and every file in its `references/` |
| `{{design_step}}` | plan. engine side: `` `design.md` per engine/references/workflow.md stage 2, with the security review rows for everything the change touches. REVIEW design r1.`` studio: `` `design.md` per studio/references/workflow.md stage 2: per task, its flow through the screens and the API call behind each action, the console captures read for its UX, and what is shared. REVIEW design r1.`` |
| `{{refs}}` | rev: `AGENTS.md, issues/README.md` plus the module's `AGENTS.md` and every file in its `references/`, plus `tests/integration/AGENTS.md` |
| `{{precedents}}` | zero to two related archives: `, .pm/archive/<m>.md (precedent)`; else empty |
| `{{targets}}`, `{{capture_wt}}` | crit: the routes to capture, and the worktree that holds every studio unit of the issue |
