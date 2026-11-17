Issue-Id: 315
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|integration|run-time
Issue-Check-Ids:
Issue-Commit: c1407f817d80566da76599230303a02165011615

# Cut the integration run's time: run the browser checks side by side by service and the two slowest checks' cases in parallel

> Identified against commit `c1407f817d80566da76599230303a02165011615`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration step of a full `pm-check` takes about ten and a half minutes for 135 checks, and every service
screen adds browser checks to it: the owner decided on 2026-11-17 that every service the emulator supports gets
its screens (issues 69 to 314), so the step grows with each of them unless it runs differently.

Where the time goes, from the record of `feat/55-e1` at `d42d782` on 2026-11-17 (the same within two seconds in
the runs of `feat/63-h2` and `feat/54-t1`):

| Group | Checks | Seconds |
|---|---|---|
| Studio browser checks | 62 | 390 |
| `engine.product-*` | 16 | 187 |
| engine | 53 | 20 |
| emulator image | 4 | 12 |

- The checks run one after another: the times add up to the step's (609 of 634 seconds).
  `tests/integration/studio/playwright.config.ts` has `fullyParallel: false` and `workers: 1`.
- Two checks take 43 percent of the step by what they do, not by a fault:
  `studio.count-and-unit-stay-on-one-line` (132 s) resizes Home through 104 widths in 18 languages and 3 states,
  one page after another; `engine.product-does-not-come-up-on-a-port-collision` (138 to 140 s) runs eight cases
  one after another, four of which wait out the 30-second health bound.
- Images are not the cost: the emulator image is tagged, the product image is a cache hit.
- Memory is not the limit: a run's emulator container holds about 230 MB, its browser about 0.2 GB. Docker
  Desktop's VM has 8.3 GB shared with other projects' containers, so one emulator per worker is not the way.

What the requirement has to settle:

- Browser checks of different services do not see each other's resources in one emulator, so workers grouped by
  service can share the run's emulator. Checks that stop, start or replace the emulator or the engine (Home,
  the connection states, `own-emulator` checks) cannot run beside others: say how the manifest tells the two
  kinds apart and how a new check gets its kind.
- The two slow checks keep what they assert. Their cases run in parallel inside the check (languages; the
  collision cases, which already use their own compose project and ports). The 30-second bound and the 2-pixel
  step stay: each is there for a failure that happened (issues 34, 32).
- A confirmed check changes only on the `pm`'s decision with a recorded reason, through a `t` unit.
- The run stays within the CPU limit `pm-check` already waits for, and its verdicts stay as stable as today: the
  flake record is the measure (`.pm/run/flakes.jsonl`).
- The workflow on GitHub Actions runs the same way or says why not (a runner has four cores).
- The harness tests step took 426 seconds in the same record: say where that goes, and file it as its own issue
  if it is not small.

## Evidence

`../emuforge-55-e1/output/checks/last.json` (step `integration` 634.5 s, `harness-test` 426.1 s) and
`../emuforge-55-e1/output/integration/report.json` (the seconds of each check) on 2026-11-17.

## Steps to Reproduce

1. `pm-check <worktree> --full` on any branch.
2. Read the `integration` step's seconds and the seconds of each check in `output/integration/report.json`.

## Expected

- The integration step of a full run takes clearly less than today on this machine, with the same checks and the
  same verdicts; the requirement names the target from a measurement.
- Adding a service's browser checks adds little to the step's time.
- No check asserts less than it does today.

## Out of scope

- Running fewer checks for a unit (issue 63 settled which steps a unit runs).
- The emulator image's refresh (issue 68) and the bound on image builds (issue 293).
