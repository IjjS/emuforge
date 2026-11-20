Issue-Id: 587
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|rds.create-forms|critique-p3
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Tidy RDS's create forms: grouped fields, the class example, one header convention, the version list, the password's constraint

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The critique of RDS's three forms left five cosmetic findings:

- "Create DB instance" and "Create DB cluster" hold eleven and nine fields in one container with no grouping (`pages/create-instance-page.tsx`, `pages/create-cluster-page.tsx`).
- "Add DB instance" describes the class with the example `db.t3.micro` while the field starts at `db.r6g.large` (`form.ts`, `pages/add-instance-page.tsx`).
- "Add DB instance" has a container header "DB instance"; the other two forms have none.
- "Engine version - optional" lists the oldest version first, "The emulator's default" names no version, and an option's description repeats its label (`components/create-fields.tsx`).
- "Show password" stands between the password and its constraint text, so the constraint reads as the checkbox's.

## Evidence

The impeccable critique of issue 573 on the built app, `final` r1 and r2 (the review files `review-final.md` and `review-final-r2.md` of the issue's folder, kept in `.pm/archive/573/` once it is archived; snapshot `studio/.impeccable/critique/2026-11-20T07-18-22Z__src-providers-aws-area-services-rds.md`): each line of the description is a P3 finding of it, with its file. They were left out of issue 573 as cosmetic (the plan's decision, `decisions.md`, `## Review decisions`).

## Steps to Reproduce

1. Start an emulator and Studio; open `/aws/rds/instances/create`, `/aws/rds/clusters/create` and, for a DB cluster, its "Add DB instance".
2. Read the forms at 1280 and at 390.

## Expected

- The two create forms group their fields (engine, sign-in, network) under headings; the three forms follow one convention for a container's header.
- The class example of "Add DB instance" agrees with the value the field starts at.
- The version list reads newest first when the API's order allows it, and no option's description repeats its label.
- The password's constraint text stands at the password, before "Show password".
- Every check of RDS's forms still passes.

## Out of scope

- New fields, and any change of what a form sends.
