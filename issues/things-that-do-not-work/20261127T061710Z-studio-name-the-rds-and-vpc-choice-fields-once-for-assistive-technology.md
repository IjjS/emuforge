Issue-Id: 683
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds-vpc.choice-fields|accessible-name-repeated
Issue-Check-Ids:
Issue-Commit: 356536ce22c3a368aed4425e0eb60f198d9e0b7d

# Name the RDS and VPC choice fields once for assistive technology

> Identified against commit `356536ce22c3a368aed4425e0eb60f198d9e0b7d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Some choice fields of the RDS and VPC forms give assistive technology their label twice: the form field's label
names the control, and the control repeats the same words in its own accessible name. Found by the impeccable
critique of issue 651 (`final`, P3). The fields named: "DB instance class" and "Storage type"
(`studio/src/providers/aws/area/services/rds/components/choice-fields.tsx:139`), "VPC" (`studio/src/providers/aws/area/services/vpc/components/vpc-field.tsx:127`) and "Availability Zone"
(`studio/src/providers/aws/area/services/vpc/pages/create-subnet-page.tsx:289`). The reference is the area's other form fields, whose control is named
once, by its form field.

The critique's second `final` found the same repetition in one EC2 field, "KMS key" of the create volume form
(`studio/src/providers/aws/area/services/ec2/pages/create-volume-page.tsx:316`); it is this issue's as well.

## Evidence

`.pm/issue-651/review-final.md`, section P3 (RDS s2 and VPC s10), on the built app of `feat/651` at `356536ce`; the
critique's accessibility tree dump is `output/crit-b/field-choices-final.json` in the issue's worktree
(`emuforge-651`), which is not kept after the issue is archived: read the tree again on `main`.

## Steps to Reproduce

1. Start a fresh emulator and open Studio on it.
2. Open `/aws/rds/instances/create` and `/aws/vpc/subnets/create`.
3. Read the accessible name of "DB instance class", "Storage type", "VPC" and "Availability Zone" in the browser's
   accessibility tree.

## Expected

- Each of the four controls, and the create volume form's "KMS key", has its label once in its accessible name.
- The chosen value of each is still exposed to assistive technology.

## Out of scope

- The fields' options, descriptions and reads (issue 651).
- Choice fields of other services, unless the same reading finds the same repetition in a shared part.
