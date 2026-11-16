Issue-Id: 59
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|faces-check|platform-faces-on-linux
Issue-Check-Ids:
Issue-Commit: 3fe1072bb359e60a3c71e72169eebb96dd1dc3a9

# Let the faces check accept the platform's Korean and Japanese faces on Linux

> Identified against commit `3fe1072bb359e60a3c71e72169eebb96dd1dc3a9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio.language-faces-per-script` (issue #17) fails on an Ubuntu runner. It allows Korean text only in "Apple
SD Gothic Neo" and Japanese text only in "Hiragino Sans", which are macOS faces. Studio's own font stacks name
more than those (`studio/src/ui/tokens.css`: for Korean also "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK
KR"; for Japanese also "Yu Gothic UI", "Noto Sans JP", "Noto Sans CJK JP"), because Hangul, kana and Han are
drawn by the platform's face by design. The check knows one platform; on Linux the runner draws those runs
with the face it has (WenQuanYi Zen Hei, which Playwright's dependencies install), which is in neither the
check's list nor Studio's stack.

So two things are open: the check is written for macOS only, and on a Linux machine without a Korean or
Japanese face of Studio's stack, Studio's Korean and Japanese text falls to whatever the system has.

Found by the first run of issue #53's workflow. It is in `.github/not-run.json` under this issue until fixed.

## Evidence

GitHub Actions run 43861083645 (branch `feat/53-h2`, 2026-11-16), step "integration (second run)", saved by the
PM at `.pm/issue-53/ci/run-43861083645-failed.log` (main checkout, local):

```
studio: failed  studio.language-faces-per-script (8.4s)  Error: 3 of 6 criteria lines failed:
"en page: \"한국어\" (lang ko) in span is drawn by WenQuanYi Zen Hei (3); allowed: Apple SD Gothic Neo",
"en page: \"日本語\" (lang ja) in span is drawn by WenQuanYi Zen Hei (3); allowed: Hiragino Sans",
"ko /: \"홈\" (lang ko) in h1 is drawn by WenQuanYi Zen Hei (1); allowed: Apple SD Gothic Neo",
```

The check passes on macOS in every local run.

## Steps to Reproduce

1. Run the integration suite on Ubuntu 24.04 with Playwright's Chromium (`.github/workflows/main.yml`).
2. `studio.language-faces-per-script` fails on every Korean and Japanese run.

## Expected

- The check allows, for each script, the faces of Studio's stack for that script that the platform has, and
  says which platform it ran on; it still fails when a run is drawn by a face outside the stack.
- The runner has a face of Studio's stack for Korean and Japanese (the workflow installs one), so the check
  runs there instead of being left out, and its entry leaves `.github/not-run.json`.
- What Studio does on a machine with no face of the stack is stated in `studio/DESIGN.md`.

## Out of scope

- Serving Korean or Japanese faces from Studio (they are too large; `studio/DESIGN.md`).
