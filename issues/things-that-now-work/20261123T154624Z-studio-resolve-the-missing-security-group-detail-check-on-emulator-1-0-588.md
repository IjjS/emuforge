Issue-Id: 636
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ec2-security-group-missing|emulator-588
Issue-Check-Ids: studio.ec2-security-groups-made-elsewhere-and-in-use
Issue-Commit: 656c3dcff92f06479ebb3d75ed48ab98a82947d5

# Resolve the missing security group detail check on emulator 1.0.588

> Identified against commit `656c3dcff92f06479ebb3d75ed48ab98a82947d5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The missing-group scenario stopped at the direct DescribeSecurityGroups reference read, which returned HTTP 400 for the absent ID.

## Evidence

Emulator 1.0.588 on main f63a3eeef: output/checks/2026-11-24T002244.json and .pm/run/main-image-1.0.588.log. The check reported one failure among six criteria.

## Steps to Reproduce

Run studio.ec2-security-groups-made-elsewhere-and-in-use with the isolated emulator and inspect the absent-group direct read and Studio result.

## Expected

The check verifies the named missing-group state and its link back to the security groups list against the actual emulator response.

## Out of scope

Other EC2 scenarios.
