Issue-Id: 589
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|area.choice-multiselect|load-more-adds-nothing
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Do not offer "Load more" in a choice field when the next page adds nothing

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The area's paged choice field offers "Load more" whenever the answer carries a token. The emulator returns a token with the last security group, so RDS's "Security groups - optional" (and EC2's forms, which read the same list) shows "Load more" under the last group; choosing it adds nothing (`studio/src/providers/aws/area/components/use-paged-choices.ts`, `choice-multiselect.tsx`).

## Evidence

The impeccable critique of issue 573 on the built app, `final` r1 and r2 (the review files `review-final.md` and `review-final-r2.md` of the issue's folder, kept in `.pm/archive/573/` once it is archived; snapshot `studio/.impeccable/critique/2026-11-20T07-18-22Z__src-providers-aws-area-services-rds.md`): each line of the description is a P3 finding of it, with its file. They were left out of issue 573 as cosmetic (the plan's decision, `decisions.md`, `## Review decisions`).

## Steps to Reproduce

1. Start an emulator and Studio; open `/aws/rds/instances/create`.
2. Open "Security groups - optional": "Load more" stands under the last group; choose it: no group is added.

## Expected

- After a load that added no item, the field no longer offers "Load more" and says nothing was left.
- A list of more than one page still loads every page.

## Out of scope

- The emulator's token with its last page (reported upstream if it differs from AWS).
