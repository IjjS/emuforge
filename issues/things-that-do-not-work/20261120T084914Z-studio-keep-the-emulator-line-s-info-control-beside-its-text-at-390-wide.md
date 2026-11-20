Issue-Id: 605
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|area.emulator-line|info-control-alone-at-390
Issue-Check-Ids:
Issue-Commit: 2355a3d14feba0df2d6c8551e7247feeac412d73

# Keep the emulator line's info control beside its text at 390 wide

> Identified against commit `2355a3d14feba0df2d6c8551e7247feeac412d73`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

At 390 wide the (i) control of the area's emulator line stands alone on a row of its own, under the text it belongs to. The part is shared by every service's screens (`studio/src/providers/aws/area/components/emulator-line.tsx`), so issue 574 did not change it.

## Evidence

The impeccable critique of issue 574 on the built app of `feat/574` (aws-emulator 1.0.533), its review files `review-final-r1.md` to `review-final.md` (r4) kept with the issue's working files; captures at 1280 and 390 under the issue worktree's `output/captures/final-r4/`. Final r1 P3, r2 P3 and r4 P3 (`components/emulator-line.tsx`), on the 390 captures of VPC's screens.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/vpc/vpcs` at 390 wide.
3. The (i) control of the emulator line is on a row of its own.

## Expected

- At 390 wide the control stays on the line of the text it explains, on every screen of the area.

## Out of scope

- The line's words.
