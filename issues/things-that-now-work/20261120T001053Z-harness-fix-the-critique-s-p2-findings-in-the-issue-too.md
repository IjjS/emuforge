Issue-Id: 552
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|critique|p2-is-fixed-in-the-issue
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 52ec3eed0717188191120a2cc0d9349e00f4d5a6

# Fix the critique's P2 findings in the issue too

> Identified against commit `52ec3eed0717188191120a2cc0d9349e00f4d5a6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-20: "크리틱 P2도 반영하자".

Since 2026-11-18 a P0 or P1 finding of the impeccable critique's `final` is fixed in the issue and everything else is
told only; a plan files the P2 and P3 as LOW issues. The screens of six services stand at 24 to 29 of 40 and their
P2 lie in issues 513, 514, 518, 532, 543, 550.

Wanted: a P0, P1 or P2 finding of the last `final` is fixed in the issue; a screen changed by such a fix is critiqued
once more, as today for a P1. A P2 is left unfixed only when fixing it would change the requirement or a confirmed
check: then the plan sends it to the `pm` as a decision. A P3 is the plan's to adopt or not, with a reason, and may be
filed. The score still decides nothing. `studio/references/critique.md`, `lead.md` (Critique, Close, what becomes an
issue of its own), the briefs of `plan` and `crit`, the `pm`'s SKILL where it says what is fixed, and `pm-critique
check` (it fails while the last `final` holds a P0, P1 or P2; the record takes the P2 count) follow. No test is added
(issue 523). Issues in flight when this lands follow it from their next `final`.

## Evidence

The reports of issues 496, 512, 516, 531, 535, 536 ("Critique": scores and the P2 filed).

## Steps to Reproduce

Lead a Studio issue to its `final`: a P2 is filed, not fixed.

## Expected

The last `final` of an issue holds no P0, P1 or P2.

## Out of scope
