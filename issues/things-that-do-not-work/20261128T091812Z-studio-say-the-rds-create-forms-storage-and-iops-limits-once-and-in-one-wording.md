Issue-Id: 697
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds-create-forms-storage-and-iops-messages|wording
Issue-Check-Ids:
Issue-Commit: 3f577807449ba6f1767d27dae25fe024b036a93f

# Say the RDS create forms' storage and IOPS limits once and in one wording

> Identified against commit `3f577807449ba6f1767d27dae25fe024b036a93f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The critique of issue 651 (rounds seven and eight of its `final`, on the RDS create forms) left five P3 findings
about how "Allocated storage" and "Provisioned IOPS" say their limits, and one about a page's alert:

- The storage error ("The storage is a whole number from {min} to {max}…") is shown directly above the field's
  constraint, which gives the same range, so the range is read twice.
- The IOPS range error repeats its constraint's text.
- Before the class's rows are read, or when their read fails, the storage constraint reads "A whole number from 20
  to 65536." and then changes to "5 to 65536 GiB.": two wordings for one thing.
- For a class with no gp2 row the check falls back to 20 GiB while the field still says "The emulator creates gp2
  storage."; what the emulator does for such a class was not called.
- "Add DB instance" shows the alert "These DB clusters are in your local emulator" under its heading, words written
  for the clusters list.

## Evidence

`.pm/issue-651/review-final-r7.md` and `review-final-r8.md` (section P3), written by the crit on `feat/651` at
`3f577807`: `studio/src/providers/aws/area/services/rds/form.ts` (the storage error and constraint, the IOPS error),
`rds/components/create-fields.tsx`, `rds/components/choice-fields.tsx` (the IOPS constraint, "The emulator creates
gp2 storage."). The emulator, asked with no storage type, made gp2 storage of 5 GiB
(`output/logs/crit-r7-storage-probe.log` of the issue's worktree, not kept after the merge).

## Steps to Reproduce

1. Open `/aws/rds/instances/create`, choose a class and type `4` in "Allocated storage"; press "Create DB instance":
   the error and the constraint under it give the same range.
2. Choose io1 and type an IOPS value outside its range: the error equals the constraint.
3. Open the form and read the storage constraint before the class's rows have answered, then after.
4. Open a cluster's "Add DB instance" and read the alert under the heading.

## Expected

A limit is said once where it is broken, in one wording whether the rows are read or not; the fallback for a class
without a gp2 row says what the emulator does, found by calling it; the add instance page's alert fits a new
instance.

## Out of scope

The limits themselves (issue 651), the repeated accessible names of the choice fields (issue 683).
