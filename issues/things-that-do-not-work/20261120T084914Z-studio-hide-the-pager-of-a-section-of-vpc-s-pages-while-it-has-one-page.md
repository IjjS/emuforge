Issue-Id: 606
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|vpc.sections|pager-shown-for-one-page
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Hide the pager of a section of VPC's pages while it has one page

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The sections of a VPC's page ("Subnets", "Route tables") and of a route table's page ("Routes", "Subnet associations") show a pager "‹ 1 ›" under one to three rows, where there is nothing to page; at 390 a list shows a second one under its rows.

## Evidence

The impeccable critique of issue 574 on the built app of `feat/574` (aws-emulator 1.0.533), its review files `review-final-r1.md` to `review-final.md` (r4) kept with the issue's working files; captures at 1280 and 390 under the issue worktree's `output/captures/final-r4/`. Final r1 P3, r3 P3 and r4 P3 (`services/vpc/pages/vpc-page.tsx`, `route-table-page.tsx`).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open the default VPC's page under `/aws/vpc/vpcs`.
3. "Route tables" holds one row and a pager.

## Expected

- A section whose rows are one page and whose read gave no further token shows no pager; with a further page it shows one, as now.

## Out of scope

- The lists' own paging.
