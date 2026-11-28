Issue-Id: 698
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ec2-form-choice-checks|option-figures-and-manifest-rows
Issue-Check-Ids:
Issue-Commit: 079c9f2dffeb080c33d56ec6a449caff0c80004f

# Assert the EC2 launch check's option figures against the emulator and complete two manifest rows

> Identified against commit `079c9f2dffeb080c33d56ec6a449caff0c80004f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The third round of the tests review of issue 651 passed and left three findings about its EC2 integration checks.
They were not fixed in the issue: the stage had used its three rounds, and a change to the passing submission
would have needed another.

- `studio.ec2-launch-and-retype-follow-the-vpc-and-the-zone` asserts what a subnet's option and an instance type's
  option show only as fixed words (`free addresses`, `vCPU`, `GiB`, one of three architectures). The option of
  another subnet or type would pass. Every other described option of the issue's checks is compared with what the
  emulator reports of the same resource.
- In the same check, "Subnet" being empty after the VPC changed is asserted as the trigger not showing two texts,
  not as the empty select's own words.
- Two rows of `tests/integration/studio/services/ec2/manifest.jsonl` leave out operations their checks' cleanup
  calls: `studio.ec2-group-rule-and-key-pair-forms-describe-and-tag` (`ec2:DescribeInstances`,
  `ec2:ModifyInstanceAttribute`, `ec2:RevokeSecurityGroupIngress`) and
  `studio.ec2-volume-forms-choose-type-snapshot-key-and-instance` (`ec2:ModifyInstanceAttribute`,
  `ec2:DescribeSecurityGroups`, `ec2:DescribeKeyPairs`).

## Evidence

`.pm/issue-651/review-tests-r3.md` (P2 and both P3), on `feat/651` at `079c9f2d`:
`tests/integration/studio/ec2-form-choices.spec.ts` lines 240 to 243 and 278 to 279, and the two manifest rows.

## Steps to Reproduce

1. Read the two lines of `ec2-form-choices.spec.ts` named above and the two rows of the EC2 manifest.

## Expected

The subnets' options are asserted with the free address count `DescribeSubnets` reports, the type's option with the
vCPUs, the memory in the form's unit and each architecture `DescribeInstanceTypes` reports; the emptied "Subnet"
is asserted by its placeholder; each row names every operation its check calls
(`tests/integration/references/services-and-manifest.md`).

## Out of scope

The forms themselves; the other checks of issue 651.
