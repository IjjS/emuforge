Issue-Id: 607
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|vpc.screens|critique-p3-left
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Tidy what the critique of VPC's screens left: the attach page, the gateways' notice, small labels

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Small findings (P3) of the critique of issue 574 that were not adopted in it:
- The attach page names the gateway by its name only ("Attaches {name} to a VPC."), never its ID.
- The attach page's already-attached notice has no title and shows the VPC's ID as text, not as a link to the VPC's page.
- The Internet gateways list opened for a VPC (`?vpc=`) names that VPC by ID only, offers no way to drop the VPC, and nothing leads the eye to the detached rows.
- A VPC's page shows its internet gateway's ID without a copy control (`aws-area.md`, guidance entry 3).
- The associate-subnet page has a container header "Subnet" above the field "Subnet".
- "Associated subnets 0" on a main route table reads as unused, though it serves every subnet without an association of its own.
- A resource's page in its not-found state offers no "Refresh".

## Evidence

The impeccable critique of issue 574 on the built app of `feat/574` (aws-emulator 1.0.533), its review files `review-final-r1.md` to `review-final.md` (r4) kept with the issue's working files; captures at 1280 and 390 under the issue worktree's `output/captures/final-r4/`. Final r1 P3 (the main table's count, Refresh in the not-found state), r2 P3 and r3 P3 (the attach page, the container header), r4 P3 (the notice, the copy control).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc/internet-gateways`, select the default VPC's gateway and choose "Attach".
3. The notice that it is attached has no title and its VPC ID is text.

## Expected

- Each line of the description is settled: changed, or recorded as left with its reason.
- The words of a screen that the requirement of issue 574 fixed change only with a recorded decision.

## Out of scope

- The layout of the lists (its own issue) and the pager (its own issue).
