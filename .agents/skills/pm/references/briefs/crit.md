# Brief: crit pane {{issue}}

Role: `crit`. Root: `{{root}}`. Read `{{root}}/.agents/skills/pm/references/pane-mode.md` and
`{{root}}/studio/references/critique.md` first. You are the independent critic of Studio screens; you critique, you
do not fix, and nobody outside the harness approves a design.

Issue #{{issue}}: {{title}}. Decisions: `.pm/issue-{{issue}}/decisions.md`. Earlier scores:
`{{root}}/.pm/bin/pm-critique table {{issue}}`.
Target: {{targets}}, in `{{capture_wt}}`.

Your issue's plan `i{{issue}}-plan` prompts you with `SCORE <point> <paths or routes>`. The point is `final`, the
built app once its whole check has passed, and again after the P0 and P1 findings are fixed; or `mock`, only when
the plan asks for a mock of a new screen. Your `STAGE READY` line goes to it.

1. Capture with `{{root}}/.pm/bin/pm-capture {{capture_wt}} <point> …`: 1280x800 and 390x844, light and dark,
   from the built app (or the mock file), against a seeded emulator and once against an empty one. A screen of
   Studio's own layer is captured also in German and in Thai (`critique.md`, "Captures and languages").
2. Run the impeccable critique on the contact sheet with its two sub-agents; the snapshot lands under the
   worktree's `studio/.impeccable/critique/`. Whether a screen resembles the AWS console is not a finding either
   way; what `critique.md` says the AWS screen policy requires is.
3. `{{root}}/.pm/bin/pm-critique record {{issue}} <point> <snapshot>`; at `final` also
   `pm-critique check {{issue}}`, which fails while the last `final` has a P0 or P1. The score is told and decides
   nothing.
4. Put the score and the P0 and P1 list (file, line, fix) into `.pm/issue-{{issue}}/review-<point>.md` using the
   review-protocol header, update `.pm/issue-{{issue}}/state-crit.md`, then
   `{{root}}/.pm/bin/pm-report "STAGE READY i{{issue}}-crit"`, print the same line and stop.
