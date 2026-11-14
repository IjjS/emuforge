Issue-Id: 4
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|structure-score|missing
Issue-Check-Ids:
Issue-Commit: e55940995ba32d732a9dbc77a3796d54bd3a1ef7

# Build the structure score tool for console screens

> Identified against commit `e55940995ba32d732a9dbc77a3796d54bd3a1ef7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A Studio screen that mirrors an AWS console screen passes on its structure score: matched reference spec items
over all items that are not omitted, read from the accessibility tree at 1280x800
(`studio/references/console-reference.md`). The method is written down but no tool computes it, so the first
`console` screen cannot be judged and would stall at critique.

The tool reads a reference spec and a running screen and prints the score, the matched and unmatched items, and
whether the pass line is met (90 or more, with title, primary action and table columns all matched).

## Evidence

```
$ grep -n "structure score" .agents/skills/pm/SKILL.md
- The structure score tool for `console` screens (`studio/references/console-reference.md` defines the method).
$ ls .pm/bin | grep -i -E "score|structure"
$
```

`pm-capture` produces captures and `pm-critique` records impeccable scores; neither reads a reference spec.

## Steps to Reproduce

1. Write a reference spec per `studio/references/console-reference.md` for any page.
2. Look for a command that scores a page against it: there is none.

## Expected

- One command under `.pm/bin/` takes a reference spec and a served screen and prints score, matched items,
  unmatched items and pass or fail; the exit status is the verdict.
- The same spec and the same screen always give the same score.
- A fixture page that matches its spec fully scores 100; fixtures with a missing column, a renamed primary action
  and a missing title each fail for that reason, and the output names the item.
- `omitted` entries are left out of the denominator and are listed in the output with their reasons.
- The result is written where `rev` and the `pm` read evidence (the worktree's `output/`), and the `crit` brief
  and the PM skill name the command.
- The tool's own tests run in `pm-check`.

## Out of scope

- Writing reference specs for real screens; each comes with its screen's issue.
- Pixel or visual comparison against AWS console captures (the owner supplies those later; verified separately).
- The impeccable score.

Needs the Studio toolchain (issue #3) if it is built on Playwright there.
