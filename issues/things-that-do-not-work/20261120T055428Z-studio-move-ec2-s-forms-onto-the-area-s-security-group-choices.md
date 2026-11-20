Issue-Id: 577
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ec2.security-group-choices|duplicate-of-area-part
Issue-Check-Ids:
Issue-Commit: 08ec9b9ff80a1a3ec4e6fc224bfd03ce6e0cbcfe

# Move EC2's forms onto the area's security-group choices

> Identified against commit `08ec9b9ff80a1a3ec4e6fc224bfd03ce6e0cbcfe`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Issue 573 (RDS) adds the area's reader of EC2's security groups as a form's choices,
`studio/src/providers/aws/area/components/security-group-choices.ts`, because RDS is the second service whose form
chooses among them. EC2's launch form and add-rule form still read the groups through EC2's own reader
(`services/ec2/choices-api.ts` `listGroupChoices`, `services/ec2/choices-queries.ts` `groupChoices`), so the area
holds two readers of one list. `studio/AGENTS.md` ("what two services share moves to the area's `components/` … when
the second one needs it") and `studio/references/aws-area.md`, point 9, ask for one.

## Evidence
- `.pm/issue-573/design.md`, "What is shared", and `.pm/issue-573/decisions.md`, `## Plan decisions` and
  `## Review decisions` (plan-set r1, P2 1: `review-plan-set-r1.md`).
- On `main` at the commit above: `grep -n "listGroupChoices\|groupChoices" -r studio/src/providers/aws/area/services/ec2`
  names EC2's reader in `choices-api.ts`, `choices-queries.ts`, the launch and add-rule pages, and
  `group-queries.ts` and `group-form-queries.ts`, which read the choices again by `EC2_KEYS.choices`.

## Steps to Reproduce
1. On a checkout that holds issue 573, list `studio/src/providers/aws/area/components/security-group-choices.ts`.
2. `grep -rn "DescribeSecurityGroupsCommand" studio/src/providers/aws/area --include=*.ts -l` names both that file
   and `services/ec2/choices-api.ts` as readers of a form's choices.

## Expected
- EC2's launch form and add-rule form read their security-group choices through the area's part; EC2's folder holds
  no reader of security groups as choices of its own.
- After a security group is created or deleted from Studio, the choices of an open form are read again, as today.
- Every EC2 check that passes on `main` still passes; the launch form still offers the groups of the chosen
  subnet's VPC, or of the default VPC without one.

## Out of scope
EC2's list of security groups (S4) and its other choice readers (images, types, subnets, VPCs, key pairs).
