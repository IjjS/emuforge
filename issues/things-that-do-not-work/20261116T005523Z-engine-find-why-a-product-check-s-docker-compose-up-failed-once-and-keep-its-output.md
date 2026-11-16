Issue-Id: 43
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|product-checks|compose-up-intermittent
Issue-Check-Ids:
Issue-Commit: 995711dab9caa34eb1eca76ec0f249a13eea4379

# Find why a product check's docker compose up failed once and keep its output

> Identified against commit `995711dab9caa34eb1eca76ec0f249a13eea4379`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`engine.product-connects-when-the-emulator-starts-later` (issue #34) failed once and passed on the retry that
`pm-check` gives a test step. The failure was the check's own start of the product form: `docker compose up -d
--build` ended with a failure status after 16 s, and the check's error carried no output at all, so the cause
is unknown. The other fifteen product checks of the same run passed. The unit under check changed only a
harness test file (issue #33 `t1`), so the unit did not cause it.

Two things are wrong: something makes that start fail now and then, and when it does the check says nothing
about why (its message ends at "output:" with nothing after it, and the check's own log was overwritten by the
retry).

## Evidence

`.pm/run/flakes.jsonl`, 2026-11-16T09:27:22+09:00, step `integration`, checkout `emuforge-33-t1`, commit
`0b1b5e4`; first log `output/logs/check-integration.attempt1.log` in that worktree (removed when issue #33 was
archived). From it:

```
studio: failed  engine.product-connects-when-the-emulator-starts-later (16.1s)  Error: docker compose up -d --build: exit code; output:
studio: passed  engine.product-reconnects-after-the-emulator-restarts (15.4s)
studio: passed  engine.product-does-not-come-up-on-a-port-collision (159.2s)
...
integration: report .../output/integration/report.json, exit 1
```

The retry's log of the same check ends `docker compose --profile emulator down: exit 0`, `verdict passed`.
Other worktrees were running their own checks at the time (issues #32 and #37).

## Steps to Reproduce

Not reproduced on demand; seen once. Running the product checks while another worktree builds or starts its own
product form is the first thing to try (shared Docker build cache and image names per run).

## Expected

- The cause is named: measured, with the numbers, alone and beside another run.
- When a product check's `docker compose` command fails, the check's message and its log hold the command's
  standard output and standard error, and the first attempt's per-check log is not lost to the retry.
- The start no longer fails for that cause, or, if the cause is the environment (another run holding a Docker
  resource), the check ends with the verdict `error` and says so, as `tests/integration/AGENTS.md` asks.

## Out of scope

- The product form itself, unless the cause is in it.
