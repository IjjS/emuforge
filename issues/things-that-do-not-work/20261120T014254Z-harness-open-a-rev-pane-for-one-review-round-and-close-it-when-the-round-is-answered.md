Issue-Id: 557
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|rev|one-pane-a-review-round
Issue-Check-Ids:
Issue-Commit: b4afbc3c7e459cd82635adf32d7d1c4b04f45907

# Open a rev pane for one review round and close it when the round is answered

> Identified against commit `b4afbc3c7e459cd82635adf32d7d1c4b04f45907`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-20: "rev는 일회성으로 하자 그럼. 사실상 서브에이전트랑 같지만 유연함을 위한 단독 독립 에이전트네".

Today one `rev` pane serves an issue from its first review to its last: by the end its context stands at 175 to
230 thousand tokens (issues 496, 512, 516, 531, 535, 536), about half of its cost is reading that context again at
every call (issue 535's `rev`: 195 calls, 27 M cache-read tokens of 11.4 dollars), and round 2 is read by an agent
that remembers round 1 where the protocol wants files only. A sub-agent of the plan would start fresh each round but
ties the reviewer to the plan's vendor and to vendor-specific agent files; a pane keeps the model, the effort and the
vendor a matter of `pm-pane`'s options.

Wanted: a `rev` pane lives for one round. For each `REVIEW <stage> r<k>` the plan opens `rev` with `pm-pane new`
(the same brief, model and effort each time), sends the round, and closes the pane when its `REVIEWED` line has
arrived and the review file is there; the next round, of the same stage or the next, gets a new pane. What a round
reads is the files the protocol names (the earlier rounds' review files among them, where the protocol has the
reviewer check that its P1 were answered), nothing remembered. `lead.md`, `review-protocol.md`, `pane-mode.md`, the
`rev` brief (it no longer keeps a state note across rounds or waits for a next prompt) and `pm-brief` follow; so does
whatever counts or names panes by issue where a second `i<id>-rev` after the first was closed must be accepted
(`pm-pane new`, the registry, `pm-archive`'s cost by pane). `pm-merge` still asks the `impl` review's pass, and
refuses when a round's number is missing between the first and the last review file of a stage, so that a review is
not run again in place of being answered. `crit` stays a pane as it is. No test is added (issue 523). Issues in
flight follow it from their next round.

## Evidence

`.pm/archive/{496,512,516,531,535,536}/cost.json` (the `rev` panes' `ctx_max`, `cr`, `cost`).

## Steps to Reproduce

Lead an issue through two review rounds: one `rev` pane answers both.

## Expected

Each review round is read by a pane that holds nothing but its brief and the files.

## Out of scope
