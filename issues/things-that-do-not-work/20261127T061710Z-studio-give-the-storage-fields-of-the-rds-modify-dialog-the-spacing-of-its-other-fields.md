Issue-Id: 684
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds.modify-instance-dialog|storage-spacing-390
Issue-Check-Ids:
Issue-Commit: 356536ce22c3a368aed4425e0eb60f198d9e0b7d

# Give the storage fields of the RDS modify dialog the spacing of its other fields at 390 px

> Identified against commit `356536ce22c3a368aed4425e0eb60f198d9e0b7d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In the RDS "Modify" dialog of a DB instance at 390 px, "Allocated storage" sits closer to the "Storage type" field
above it than the dialog's other rows sit to each other (`studio/src/providers/aws/area/services/rds/components/modify-instance-dialog.tsx:334`). Found
by the impeccable critique of issue 651 (`final`, P3). The reference is the spacing of the same dialog's other
fields.

## Evidence

`.pm/issue-651/review-final.md`, section P3 (RDS s4), on the built app of `feat/651` at `356536ce`, captures at
390x844 of the seeded RDS forms (`output/captures/final-seeded-rds/` in the issue's worktree, not kept after the
issue is archived: capture the dialog again on `main`).

## Steps to Reproduce

1. Start an emulator with one standalone DB instance and open Studio on it at 390x844.
2. Open the instance's page and "Modify".
3. Compare the gap above "Allocated storage" with the gap between the other fields.

## Expected

- The storage fields of the dialog are separated from their neighbours as its other fields are, at 390 px and
  at 1280 px.

## Out of scope

- The dialog's fields, choices and request (issue 651).
