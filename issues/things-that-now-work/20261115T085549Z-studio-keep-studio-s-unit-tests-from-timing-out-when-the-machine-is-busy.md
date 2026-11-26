Issue-Id: 20
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|unit-tests|timeout-under-load
Issue-Check-Ids: studio-unit:src/test/area-preload.test.ts studio-unit:src/test/case-bounds.test.ts studio-unit:src/app/app.test.tsx studio-unit:src/app/frame.test.tsx studio-unit:src/app/routes.test.tsx
Issue-Commit: b84fd8556de9f25cfd44991f924a9b3051508f16

# Keep Studio's unit tests from timing out when the machine is busy

> Identified against commit `b84fd8556de9f25cfd44991f924a9b3051508f16`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's unit suite (`bun run test:unit`, the `studio-unit` step of `pm-check`) fails now and then with tests
that time out at Vitest's default 5 seconds, on a commit where the same tests pass before and after. It
happened while many worktrees ran their checks at once. A failed `studio-unit` step blocks `pm-merge` for a
unit that changed no Studio file, and a rerun is the only way past it, which hides real slowness too.

## Evidence

`pm-check` in the worktree of issue #9's `e9b` on commit `98e05c5` (2026-11-15T17:46+09:00), a branch that
changes no file under `studio/`; `studio-unit` passed on the two commits before it and on the rerun after it:

```
 FAIL  src/app/routes.test.tsx > routes > opens /aws as the AWS area index: "Services" (19), its line, and the 19 services in label order
Error: Test timed out in 5000ms.
 Test Files  3 failed | 15 passed (18)
      Tests  4 failed | 281 passed (285)
   Duration  8.63s (tests 57%, environment 19%, transform 12%, import 7%, setup 5%)
    Isolate  18 workers spawned · ~849ms startup each (spawn + environment, per file)
```

The four failures were all timeouts, in three files; one more was a case of `routes.test.tsx` that renders the
frame on five paths. Twelve agent panes were open at the time. The log itself was overwritten by the rerun.
Issue #16's `s2` had already raised some timeouts for the same reason (commit `57c2ff1`).

## Steps to Reproduce

1. Load the machine (for example run `pm-check` in three worktrees at once).
2. Run `cd studio && bun run test:unit` in another: now and then a case that renders the AWS area or the frame
   on several paths times out at 5000 ms.

Not reproduced on demand; seen once in this form.

## Expected

- The unit suite's verdict does not depend on how busy the machine is, within the load the harness itself
  creates (several worktrees checking at once).
- The cases that are slow are found and the cause is named (the lazy-loaded AWS area, Cloudscape rendering,
  per-file worker start-up), and fixed there where it can be; a longer timeout is set only where the work is
  slow by nature, with the reason beside it.
- A real hang still fails, in bounded time.

## Out of scope

- The integration suite's timing.
- How many panes the harness runs at once.
