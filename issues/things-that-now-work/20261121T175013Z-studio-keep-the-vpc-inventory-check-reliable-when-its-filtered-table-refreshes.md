Issue-Id: 629
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|vpc.inventory-read|row-snapshot-race
Issue-Check-Ids: studio.vpc-network-made-elsewhere-is-shown
Issue-Commit: 3e134da24c8080bc2cc487e3b900f48ed0e74b68

# Keep the VPC inventory check reliable when its filtered table refreshes

> Identified against commit `3e134da24c8080bc2cc487e3b900f48ed0e74b68`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The VPC inventory scenario finds a named VPC in the filtered list and immediately reports that the same row disappeared. The next criteria successfully find the VPC and verify its details against the local emulator. The check must evaluate the displayed row reliably across table updates and still reject missing or incorrect values.

## Evidence

Issue 525 whole check on 65170384afd855d15fe59478b3e209f7e6031b5b, emulator 1.0.556. In ../emuforge-525/output/checks/2026-11-22T024911.json only studio.vpc-network-made-elsewhere-is-shown failed. Its scenario log under ../emuforge-525/output/integration/logs/ records the first criterion failing at 0.331 seconds with “went again”. The other eight criteria held. The VPC expectRow helper observes the table twice. The same check passed on main at 3e134da24 on this emulator.

## Steps to Reproduce

1. On the loopback emulator run the named scenario with pm-check and its --checks option.
2. During the first filtered inventory assertion, observe the table as its contents update between observations. The recorded failure is timing-dependent.

## Expected

The check confirms the matched row's name, VPC ID, state, CIDR and default flag from the displayed inventory. A table refresh between observations cannot discard an already valid observation. Missing or incorrect rows continue to fail the corresponding criterion.

## Out of scope

Lambda changes, weakening any confirmed VPC criterion, or retrying failed checks to obtain a pass.
