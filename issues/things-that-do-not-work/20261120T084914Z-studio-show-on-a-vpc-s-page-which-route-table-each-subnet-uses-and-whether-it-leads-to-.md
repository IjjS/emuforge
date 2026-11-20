Issue-Id: 608
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc.vpc-page|subnet-route-table-not-shown
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Show on a VPC's page which route table each subnet uses and whether it leads to the internet gateway

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A VPC's page (issue 574) lists its subnets and its route tables in two sections, but not which table a subnet uses: to learn whether a subnet is wired to the internet gateway the developer opens each subnet's page, which does show its route table and routes. The emulator's answers hold it: a route table's associations name their subnets, and a subnet in none uses the VPC's main table.

## Evidence

The impeccable critique of issue 574 on the built app of `feat/574` (aws-emulator 1.0.533), its review files `review-final-r1.md` to `review-final.md` (r4) kept with the issue's working files; captures at 1280 and 390 under the issue worktree's `output/captures/final-r4/`. Final r4 P3 (`services/vpc/pages/vpc-page.tsx`). aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 574 was planned (its plan's probes 5; scripts and logs kept with the issue's working files, `probe/`): a subnet without an association of its own is in no table's associations, and the VPC's main table is the one of `vpc-id` with `association.main` `true`.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open the default VPC's page under `/aws/vpc/vpcs`.
3. The "Subnets" section does not say which route table a subnet uses.

## Expected

- Each subnet's row on a VPC's page names the route table it uses (its own association's, else the main one) as a link, read from the emulator.
- No text claims what the route lets through.

## Out of scope

- A resource map.
