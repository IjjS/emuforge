Issue-Id: 466
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|aws-area-first-load-unit-cases|cold-load-timeout
Issue-Check-Ids:
Issue-Commit: 6d4d6f14dabf6035320fc8697b923daab83c754a

# Give the unit cases that load the AWS area first a timeout that holds on a loaded machine

> Identified against commit `6d4d6f14dabf6035320fc8697b923daab83c754a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Unit cases that render the AWS area as the first thing in their test file wait for the area's lazy import (Cloudscape's
modules) under Vitest's default 5000 ms case timeout. On a machine running several worktrees' checks at once, that
first import takes longer and the case times out, although nothing in the page is wrong; `pm-check` then records
`studio-unit` as flaky. The cases' own wait for the area (`AREA_LOAD_MS = 10_000` in `src/app/routes.test.tsx`) is
longer than the case timeout around it, so the case ends before its own wait does. The reference is the same case
on an idle machine, which passes on every run.

## Evidence

- `pm-check` of `feat/256-s5` at 6d4d6f1, first attempt of `studio-unit`
  (`../emuforge-256-s5/output/logs/check-studio-unit.attempt1.log`, lines 8 to 31): `src/app/frame.test.tsx` "on /aws:
  no element of the frame has a Cloudscape class" and `src/app/routes.test.tsx` 'opens /aws as the AWS area index:
  "Services" …' each "Test timed out in 5000ms"; the second attempt passed (`.pm/run/flakes.jsonl`, 23:23:53).
- `pm-check` of `feat/256-t3` at 8aac217 and b139fda, first attempts
  (`../emuforge-256-t3/output/logs/check-studio-unit.attempt1.log`): the same `frame.test.tsx` case for `/aws` and
  `/aws/kinesis`, and two cases of `src/app/app.test.tsx` that open `/aws`, failed the same way and passed again.
- Neither branch changes those test files' cases or the area's loading.

## Steps to Reproduce

1. Load the machine as parallel worktree checks do (for example, run `bun run test:unit` in two checkouts at once).
2. Run `bun run test:unit` in `studio/`.
3. Some of the cases above fail with "Test timed out in 5000ms"; run again on an idle machine and they pass.

## Expected

- The cases that wait for the AWS area's first load pass on every run of `studio-unit` under the load of parallel
  worktree checks: no `studio-unit` flake in `.pm/run/flakes.jsonl` from these cases.
- A case's timeout is never shorter than the wait for the area it holds.

## Out of scope

The area's loading itself (its lazy import), and every other flaky case (`services/s3/api.test.ts`, issue 463).
