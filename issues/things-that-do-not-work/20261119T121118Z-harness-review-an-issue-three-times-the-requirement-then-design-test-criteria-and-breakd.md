Issue-Id: 519
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|lead|three-reviews-requirement-then-plan-set-then-impl
Issue-Check-Ids:
Issue-Commit: 8a5dadc0f85d12875e501116e6c94d757bc39ffc

# Review an issue three times: the requirement, then design, test criteria and breakdown as one set, then the implementation

> Identified against commit `8a5dadc0f85d12875e501116e6c94d757bc39ffc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19: "요구사항 -> 검토 -> 설계 + 검사 기준 + 분해 -> 검토 -> 구현 -> 검토 로 가자."

Today a `plan` sends each of its four stage documents to `rev` and waits for its pass before writing the next
(`.agents/skills/pm/references/lead.md`, "Each stage document is reviewed by `rev` … before the next"), then the
implementation at the end. On 2026-11-19 that was 8 or 9 review rounds an issue (494: requirement 3, design 2, test
criteria 1, breakdown 2, impl 1; 496: 2, 1, 3, 2, 1; 503: 2, 1, 2, 1, 2; 489: 2, 1, 1, 2, 2), six to eight of
them before any code, each a full read by `rev` and a full answer by the `plan`.

Wanted, for an issue led by a `plan`:

1. `requirement.md` is written and reviewed alone, as now.
2. `design.md`, `test-criteria.md` and `breakdown.md` are then written together and sent to `rev` once, as one set
   (`REVIEW plan-set r<k> …`, or the name the engineer finds fits): one review file with the three checklists of
   `review-protocol.md` applied, one verdict; a `revise` names the document each P1 is in, and the next round reads
   the set again. The limit of three rounds and `BLOCKED … review <stage>` hold for the set as for a stage.
3. The implementation is reviewed at the end, as now.

Everything that reads the stages follows: `lead.md`, `review-protocol.md` (rounds, review file names, checklists by
stage), `pane-mode.md`, the briefs of `plan` and `rev`, the module workflows where they name a review per stage
(`studio/references/workflow.md`, `engine/references/workflow.md`), `pm-brief`, any script or test that knows the
stage names or the review file names (`review-<stage>-r<k>.md`), and the `pm`'s SKILL where it names them. What each
document must hold does not change; test criteria are still written from the requirement before any code, and
`rev` still reads files only. Issues in flight finish by the rule they started under.

## Evidence

The reports of issues 489, 494, 496 and 503 (`.pm/archive/<id>/report.md`, "Review rounds").

## Steps to Reproduce

Lead an issue: count the `REVIEW` prompts before the first worker pane opens.

## Expected

Two reviews before the build (more only on `revise`), one after it.

## Out of scope
