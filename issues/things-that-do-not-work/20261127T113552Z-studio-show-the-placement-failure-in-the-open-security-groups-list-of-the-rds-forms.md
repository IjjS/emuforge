Issue-Id: 692
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds.security-groups-field|open-list-loading-after-placement-failure
Issue-Check-Ids:
Issue-Commit: 2670de14438bb8dda1ad941f87d3e4b6968b31bd

# Show the placement failure in the open security groups list of the RDS forms

> Identified against commit `2670de14438bb8dda1ad941f87d3e4b6968b31bd`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In the "Modify" dialog of a DB cluster, when the lookup of the subnet group's VPC fails while the "Security groups"
list is already open, the open list goes on reading "Loading security groups" while the field's inline error
offers "Retry" (`studio/src/providers/aws/area/services/rds/components/create-fields.tsx:304`). Found by the impeccable critique of issue 651
(sixth `final`, P3). The field is shared by the RDS create pages, the modify dialogs and the cluster snapshot
restore dialog, so the same may hold there. The reference is the area's choice fields, whose open list shows a
failed read as failed.

## Evidence

`.pm/issue-651/review-final.md` (sixth `final`, section P3), on the built app of `feat/651` at `2670de14`; the
critique's log is `output/crit-a/r6/open-failure.log` in the issue's worktree (`emuforge-651`), which is not kept
after the issue is archived: reproduce on `main`.

## Steps to Reproduce

1. Start an emulator with one DB cluster and open Studio on it.
2. Open the cluster's page and "Modify", and open the "Security groups" list while the lookup of the subnet
   group's VPC is still out (hold the `DescribeDBSubnetGroups` answer in the browser).
3. Let that read fail and read the open list and the field's status.

## Expected

- The open list does not read "Loading security groups" once the lookup has failed: it shows the failure, or it
  closes, and "Retry" stays reachable.
- After a successful retry the groups of the subnet group's VPC are offered.

## Out of scope

- Which groups are offered, kept or sent, and the lookup's status while it is out (issue 651).
