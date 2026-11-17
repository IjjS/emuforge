Issue-Id: 440
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|issue-worktree|install-after-merge
Issue-Check-Ids:
Issue-Commit: 1afb76e83de8bac79f3c6536d4af2b7bcf6d8d7b

# Install Studio's packages in an issue's worktree when a merged unit changed them, before the whole check

> Identified against commit `1afb76e83de8bac79f3c6536d4af2b7bcf6d8d7b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-worktree new <id>` runs `bun install` in an issue's worktree when it is made. Units are then merged into the
issue branch there (`pm-merge <id> <unit>`), and a unit may change `studio/package.json` and `studio/bun.lock`.
Nothing installs again, so the whole check of the issue branch runs against the packages of the day the
worktree was made.

Seen on 2026-11-17 with issue 386, the first issue on an issue branch: unit `s1` added eighteen SDK clients; the
whole check in `emuforge-386` failed `studio-typecheck`, `studio-unit` and `studio-build` with
`Cannot find module '@aws-sdk/client-api-gateway'`, while every unit had passed its own fast check and the
integration step of the same run passed. The `pm` ran `bun install --frozen-lockfile` in the worktree by hand
and ran the whole check again.

What the requirement has to settle: who installs and when (`pm-merge` after a merge into the issue branch that
changed the lock file, or `pm-check` before its Studio steps when the lock file is newer than the installed
tree), the same for `--take-main`, and for a unit's worktree after it merges the issue branch or `main`.

## Evidence

`../emuforge-386/output/logs/check-studio-typecheck.log` of the run at `cd5cb38` (2026-11-17), and the record
`output/checks/last.json` of that run.

## Steps to Reproduce

1. `pm-worktree new <id>`; merge into the issue branch a unit that adds a package to `studio/package.json`.
2. `pm-check` in the issue's worktree: the Studio steps fail for the missing module.

## Expected

- The whole check of an issue branch runs against the packages its lock file names, without a step by hand.
- A failed install is the environment's failure (`error`), told apart from a failed check.

## Out of scope

- Sharing installed packages between worktrees.
