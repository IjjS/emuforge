Issue-Id: 622
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|playwright-browser-cache|rewritten-during-a-check
Issue-Check-Ids:
Issue-Commit: acac0512fa860157afa8b5f2eae09b5b6465f3b4

# A check run loses its browser when the machine's Playwright cache is rewritten during it

> Identified against commit `acac0512fa860157afa8b5f2eae09b5b6465f3b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The whole check of issue 524 (started 2026-11-20 23:49, integration step) failed 59 browser checks in a row from
23:58 on with `browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1254/…`,
after 100 checks had passed with the same browser. Every browser folder of that cache (`chromium_headless_shell-1223`,
`chromium_headless_shell-1254`, `chromium-1254`, `ffmpeg-1013`, `.links`) carries a modification time of 23:58: the
cache was written again while the run used it. Who wrote it is not found: no harness script installs a browser at that
moment in `.pm/run/events.log`; a pane may have run an install by hand, and another project on this machine
(`alink-management`) runs Playwright from the same cache and may have installed its own version, which also removes
versions it holds unused.

The cache is the machine's, shared by every worktree, every pane and every other project, so any install anywhere can
take the browser from under a running check. The run then reports failures that are no check's verdict, and with no
second run the whole check has failed.

## Evidence

`.pm/run/evidence/524-whole-check-20261121T0010-integration.log` (line 228 on: the 59 failures; 100 `passed` before them); `ls -la ~/Library/Caches/ms-playwright/` on 2026-11-21 00:20 (every browser folder at Nov 20 23:58). The same run also failed two product checks on `docker compose up -d --build did not exit within 300s` while the machine was out of memory (issue 578's port probe, stopped): that is a second cause and not this issue's.

## Steps to Reproduce

Not reproduced on purpose. Run `bunx playwright install` (or an install of another Playwright version from another project) while an integration run's browser checks are going.

## Expected

A check run's browser cannot be removed or replaced by an install outside the run: the run uses browsers of its own place (for example `PLAYWRIGHT_BROWSERS_PATH` under the repository or `.pm/`, installed once per Playwright version and never removed while a run's lock is held), or it reports a missing browser as an error of the environment that stops the run at once with that cause instead of failing every check after it. Which of the two, and where the browsers live, is the engineer's to propose. No test is added.

## Out of scope

The machine's memory under several whole checks at once.
