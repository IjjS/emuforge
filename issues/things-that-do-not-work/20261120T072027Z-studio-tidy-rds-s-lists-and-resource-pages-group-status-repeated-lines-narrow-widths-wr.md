Issue-Id: 588
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|rds.lists-and-pages|critique-p3
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Tidy RDS's lists and resource pages: group status, repeated lines, narrow widths, wrapping dates

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The critique of RDS's lists and resource pages left five cosmetic findings:

- A DB instance's "Security groups" shows a group's status as loose text after its ID (`pages/instance-page.tsx`, "Network").
- A member's page reads "From DB cluster {id}" twice in a row, once under each of the two sign-in values.
- An empty DB cluster shows "Add DB instance" in the section's header and in its empty state (`pages/cluster-page.tsx`).
- At 390 the DB instance list's four actions wrap to three rows above the table.
- At 1280 "Created" wraps to two lines in every row of both lists, and "Engine" wraps for a long version (`aurora-mysql 8.0.mysql_aurora.3.10.3`).

## Evidence

The impeccable critique of issue 573 on the built app, `final` r1 and r2 (the review files `review-final.md` and `review-final-r2.md` of the issue's folder, kept in `.pm/archive/573/` once it is archived; snapshot `studio/.impeccable/critique/2026-11-20T07-18-22Z__src-providers-aws-area-services-rds.md`): each line of the description is a P3 finding of it, with its file. They were left out of issue 573 as cosmetic (the plan's decision, `decisions.md`, `## Review decisions`).

## Steps to Reproduce

1. Start an emulator and Studio; make a DB instance with a security group, and an Aurora DB cluster with and without a member.
2. Open the two lists and the pages of the instance, the member and the clusters at 1280 and at 390.

## Expected

- A group's status reads as a status beside its ID.
- A member's page says once where its sign-in values are from, with the link to the cluster.
- An empty cluster offers "Add DB instance" once.
- At 390 the list's actions take one row (the area's actions menu, as EC2's list has it).
- A row of either list is one line at 1280 for the values the emulator gives today, with "Port" whole.
- Every check of RDS's screens still passes, their texts unchanged where a criteria line names them.

## Out of scope

- A filter of the lists, and a combined host and port value.
