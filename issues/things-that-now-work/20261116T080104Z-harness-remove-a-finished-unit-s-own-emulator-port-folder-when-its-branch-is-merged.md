Issue-Id: 49
Issue-Severity: CRITICAL
Issue-Module: harness
Issue-Kind: bug
Issue-Source: owner
Issue-Key: harness|emulator-port-folders|clean-up-at-merge
Issue-Check-Ids: harness.emulator-dir
Issue-Commit: 1f7a38cff498ad7a19c356848c1bb887bb28597d

# Remove a finished unit's own emulator port folder when its branch is merged

> Identified against commit `1f7a38cff498ad7a19c356848c1bb887bb28597d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Every worktree is given an emulator port (9300 and up, `output/ports.json`), and every emulator writes its key
and certificate to `~/.aws/emulator/<port>/`. When a unit is finished, nothing removes that folder. A pane that
starts an emulator of its own (a check, a capture, a plan's probe) and stops it also leaves the folder behind,
often empty. The folders pile up outside the repository, and they break later work: the port is given again to
a new worktree, and the checks there take a leftover folder for an emulator somebody is running.

The owner asked for a script that removes a finished unit's own port folder, run when the unit is merged.

Order: ahead of everything else; it blocked two units on 2026-11-16.

Reference: none; the harness's own behavior.

## Evidence

- 2026-11-16, issue #31 unit `h1`: `pm-check` ended with `integration` in error and twelve
  `test_compose_side_by_side` cases in error because `~/.aws/emulator/9302` existed, empty, from 08:01, older
  than the worktree that was given port 9302. The PM removed it with `rmdir` and the same commit passed.
- 2026-11-16, issue #45 unit `s1`: its own capture emulator left an empty `~/.aws/emulator/9306`, and its next
  `pm-check` did not pass until the worker removed it.
- 2026-11-16 15:xx, `ls ~/.aws/emulator`: nineteen port folders besides the owner's `9297`. The PM removed the
  fifteen that were empty (`rmdir`); two belonged to check emulators running at that moment; two more (`9316`,
  `9317`, from 2026-11-15) still hold four files each and no emulator runs on those ports.
- `pm-worktree`, `pm-merge` and `pm-archive` do not mention `~/.aws/emulator`.

## Steps to Reproduce

1. In a worktree, start an emulator on the worktree's emulator port and stop it (as a capture or a check does).
2. `ls ~/.aws/emulator`: the port's folder is still there.
3. Merge and archive the unit, make a new worktree that is given the same port, run `pm-check` there: the
   emulator checks report the port as in use.

## Expected

- A script of the harness removes the emulator port folder of one worktree: the folder of the port in that
  worktree's `output/ports.json`, and nothing else. It refuses the owner's port (9297) and any port a container
  or a process is using, never follows a path outside `~/.aws/emulator/`, never prints or copies a file of the
  folder, and says what it removed.
- `pm-merge` runs it for the merged unit's worktree after a successful merge, and for the `t` units that arrive
  with it; a merge that fails removes nothing. Removing a worktree by other means (`pm-worktree rm`,
  `pm-archive`) does the same, so a parked or abandoned unit leaves nothing either.
- A pane that starts an emulator of its own outside a worktree's port (a plan's probe, a crit's capture) has a
  way to remove that port's folder when it stops it, and the pane rules say so.
- The same script can list and remove folders no worktree and no running emulator owns (the two left today),
  on request only.
- Harness tests cover: the folder removed at a merge; the owner's port refused; a port in use refused; a path
  outside the emulator directory refused; nothing printed from inside a folder.

## Out of scope

- The emulator's own behavior of leaving its folder when it stops.
- Changing how ports are given to worktrees.
