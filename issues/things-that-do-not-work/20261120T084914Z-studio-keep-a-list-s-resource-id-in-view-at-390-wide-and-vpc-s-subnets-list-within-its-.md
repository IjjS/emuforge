Issue-Id: 604
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|area.lists|id-out-of-first-view-when-narrow
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Keep a list's resource ID in view at 390 wide, and VPC's Subnets list within its container at 1280

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The area's lists put "Name" first and the resource ID, the row header, second. "Name" keeps room for 24 characters (`aws-area.md`, entry 4), so at 390 wide the ID starts beyond the first view and the user scrolls the table sideways to learn which row is which, though most rows' Name is "-". Seen on VPC's lists (VPCs, Subnets, Route tables, Internet gateways) and the Subnets and Route tables sections of a VPC's page; EC2's lists on `main` have the same order. In the same family: on a route table's page at 390 the routes' "State" column, the one place `blackhole` shows, is off screen; the Internet gateways list's header actions wrap at 390 with the primary one on a row of its own; and VPC's Subnets list at 1280 with the navigation open is 46px wider than its container ("Free IPv4 addresses" needs the table's own scroll), which widths alone cannot fix: its six columns need at least 990px in 951px when Name keeps 24 characters and an ID stays in two lines. Issue 574 let the first and the last stand by the pm's decisions (2026-11-20) so that the area's lists are settled together: the column order, a sticky ID, or a column off by default.

## Evidence

The impeccable critique of issue 574 on the built app of `feat/574` (aws-emulator 1.0.533), its review files `review-final-r1.md` to `review-final.md` (r4) kept with the issue's working files; captures at 1280 and 390 under the issue worktree's `output/captures/final-r4/`. Final r4, P2 1: tables of 766, 997, 823 and 735px in 350px on the four lists, every ID cell's right edge past the viewport; 789 and 639px in 348px on a VPC's sections. Final r4, P2 2: the Subnets list 997px in 951px at 1280. Final r4, P3: the routes table 463px in 348px. The worker's measurement of the widths is in the issue's `decisions-needed.md` (worker s7).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc/subnets` at 390 wide: the "Subnet ID" column is not in the first view.
3. Open it at 1280 wide with the navigation open: the table scrolls inside itself.

## Expected

- At 390 wide a list of the area shows each row's resource ID without scrolling the table, on EC2's and VPC's lists alike, by one rule written in `studio/references/aws-area.md`.
- VPC's Subnets list fits its container at 1280 with the navigation open.
- No value is cut and no page scrolls sideways (entry 4 holds).

## Out of scope

- The lists' content.
