Issue-Id: 66
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|app-test|times-out-under-load
Issue-Check-Ids: studio-unit:src/app/app.test.tsx studio-unit:src/test/case-bounds.test.ts
Issue-Commit: 65023c608818da23603d640fbf257257e20fa338

# Keep the app's unit cases from timing out at 5 seconds when the machine is busy

> Identified against commit `65023c608818da23603d640fbf257257e20fa338`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Twice in one night `pm-check`'s `studio-unit` step failed its first run and passed its second (`flaky`), with
the same cases of `studio/src/app/app.test.tsx` timing out at Vitest's default 5000 ms. Both runs were in
worktrees whose units touch no Studio source (`56-t2` writes flow checks, `55-t1` engine checks), while several
other checks ran on the machine (the CPU was above 90% at the time). The cases render the whole app and walk
routes; they are the slowest of the suite and have no margin under load.

## Evidence

`.pm/run/flakes.jsonl`, 2026-11-17T00:00:13 (commit `bc4e02b`) and 00:32:57 (commit `a4e65f5`). First-run logs:
`../emuforge-56-t2/output/logs/check-studio-unit.attempt1.log` and
`../emuforge-55-t1/output/logs/check-studio-unit.attempt1.log`:

```
× shows it in the frame and on Home, renders its area under its segment, and keeps the AWS area as it was 5020ms
× opens /aws as the AWS area index: "Services" (19), its line, and the 19 services in label order 5004ms
× on /aws: no element of the frame has a Cloudscape class 5008ms
FAIL  src/app/app.test.tsx > Studio with a second provider in the list > shows it in the frame and on Home, …
Error: Test timed out in 5000ms.
```

A fourth case ("stores nothing in localStorage, …", 70 to 85 ms) fails in the same runs, after the timed-out
case before it; whether it fails by itself or from what that case left behind is not known.

- On 2026-11-21 the whole check of issue 524 at 4f41c5cf reproduced both app.test.tsx failures: the second-provider case exceeded 5000 ms and the subsequent storage case missed the AWS heading. See ../emuforge-524/output/logs/whole-retry-studio-unit-4f41c5cf.log.

## Steps to Reproduce

1. Run `pm-check` in a worktree while two other heavy checks run.
2. Sometimes `studio-unit` fails its first run on these cases and passes the second.

## Expected

- The cases pass on a busy machine: say what is slow in them (the render, a wait, a timer) and remove it, or
  give those cases a bound that is measured, with the reason beside it.
- The storage case does not fail because the case before it timed out.
- No case is deleted or weakened.
