Issue-Id: 688
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds.modify-cluster.security-groups|unavailable-id-twice
Issue-Check-Ids:
Issue-Commit: 9ca6568bce7018a52d430993eea7a49e1dfd5e7a

# Show an unavailable security group ID once in Modify DB cluster

> Identified against commit `9ca6568bce7018a52d430993eea7a49e1dfd5e7a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In the "Modify" dialog of a DB cluster, a security group the cluster holds that the emulator's list does not is
shown by its ID twice inside the selection (`studio/src/providers/aws/area/services/rds/components/create-fields.tsx:295`). Found by the impeccable
critique of issue 651 (third `final`, P3). The reference is the same field in the DB instance's modify dialog and
issue 651's design: the ID once, with "Not in the emulator's list".

## Evidence

`.pm/issue-651/review-final.md` (third `final`, section P3), on the built app of `feat/651` at `9ca6568b`; the critique's
captures and logs are under `output/` of the issue's worktree (`emuforge-651`) and are not kept after the issue is
archived: reproduce on `main`.

## Steps to Reproduce

1. Start an emulator with a DB cluster whose `VpcSecurityGroups` hold an ID no `DescribeSecurityGroups` answer
   holds (set with `ModifyDBCluster` outside Studio).
2. Open the cluster's page in Studio and "Modify".
3. Read the "Security groups" selection.

## Expected

- The unavailable group is shown once: its ID with "Not in the emulator's list".

## Out of scope

- Which groups are offered, kept or sent (issue 651).
