Issue-Id: 472
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|pm-pane|reset-leaves-test-processes-running
Issue-Check-Ids: harness.orphans harness.orphan-event
Issue-Commit: 3e36c96a2db31f77f893d9518d270975129c5fd1

# Stop a pane's test processes when pm-pane resets or closes it

> Identified against commit `3e36c96a2db31f77f893d9518d270975129c5fd1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On 2026-11-18 seven vitest worker processes of the worktree `emuforge-467-s4` (`studio/`) were found
running with parent 1, each for 24 to 31 minutes, at about 68% of a core and 300 to 540 MB each. The pane of
that unit had been reset by `pm-pane reset` at `EVENT ctx` in that half hour, while a unit-test run of it was
going or had just been interrupted; the workers outlived the run that started them. With them the machine's load
average was 22 to 25, swap grew from 2.9 to 5.6 GB, and three fast checks of other units failed or were flaky in
`studio-unit` on cases over their 5000 ms (`/aws` of `frame.test.tsx` and `routes.test.tsx`), twice in both
attempts. After the `pm` stopped the seven processes by hand, CPU fell from 100% to 51%, memory from 17.6 to
11.5 GB, and the same fast check passed with `studio-unit` in 40 s.

Whether the reset caused it or the run's own timeout did was not shown; what is known is that nothing in the
harness stops a pane's child processes when the pane is reset or closed, and that `EVENT cpu` named the pane and
not these processes, so the `pm` read the load as a unit's check for two events.

## Evidence

`.pm/archive/467/decisions.md`, PM items of 2026-11-18 06:00 and 06:15 (the processes, their ages, the numbers
before and after). `.pm/run/flakes.jsonl`, the two lines of `emuforge-467-s4` at 05:04 and 05:13; the first log
of one is `.pm/archive/critique-snapshots/467-whole-check-evidence/s4-studio-unit-flake.attempt1.log`.

## Steps to Reproduce

Not reproduced on purpose. To try: in a worker pane start `bun run test:unit` in `studio/`, run
`pm-pane reset <pane>` while it runs, and list the processes whose parent is 1 and whose command names that
worktree's `node_modules/vitest`.

## Expected

After `pm-pane reset` and `pm-pane close`, no process started by that pane's agent is left running in its
worktree (test runners, Playwright browsers, servers a capture started); or `pm-watchd` reports processes of a
worktree that have no parent, by name, so that the `pm` does not read their load as a check's.

## Out of scope
