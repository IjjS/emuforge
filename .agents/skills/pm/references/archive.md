# Archive

Run `.pm/bin/pm-archive <id> --yes` after every unit of the issue is merged into local `main`, `pm-check .`
passed on `main`, and the final report went to the owner. The script refuses when a branch of one of the issue's
registered worktrees is not an ancestor of `main`. `--force` overrides when the owner says the issue is finished
as it is. The PM's own session id comes from `.pm/run/pm.json` (written by `pm-watchd start`); `--pm-session`
overrides it.

What it does, in order:

1. `pm-cost <id> --write`: tokens and estimated cost per pane from the transcripts into `cost.json` (the PM
   sessions are included; they span issues, so their share is indicative. A pane without a local transcript is
   not counted).
2. Closes every pane of the issue (`pm-pane close --issue <id>`), then the issue tab.
3. Removes the issue's worktrees with their `output/`; a merged branch is deleted with its worktree.
4. Writes `.pm/archive/<id>.md`: branches, `state.md`, `decisions.md`, the critique score table, the structure
   score table (`pm-structure --table <id>`), one line per review round (verdict, P1 count), the cost lines.
5. Moves the keep list to `.pm/archive/<id>/` and deletes `.pm/issue-<id>/`, so an archived issue never shows up
   as open work at session start.

## Keep list

`requirement.md`, `decisions.md`, `test-criteria.md`, `critique-scores.json`, `structure-scores.json`, `cost.json`,
`state.md`, moved to `.pm/archive/<id>/`. Everything else (briefs, `design.md`, mocks, review rounds, drafts) is
deleted; what was built is in the repository, the issue file is under `issues/things-that-now-work/`, and the
reviews are summarized in the archive.

## What the archive is for

`.pm/archive/<id>.md` is the only past an agent reads. A brief may point at one or two related archives for
precedent (decisions taken, scores reached, what was postponed). The files under `.pm/archive/<id>/` are for the
owner and for an order that arrives after archiving.

`.pm/archive/` is tracked in git; committing it is the owner's call, like every commit on `main` that is not an
issue file or a merge.
