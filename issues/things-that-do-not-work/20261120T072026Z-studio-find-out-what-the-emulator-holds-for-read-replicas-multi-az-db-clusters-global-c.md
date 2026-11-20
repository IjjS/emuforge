Issue-Id: 586
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds.further-resources|not-probed
Issue-Check-Ids:
Issue-Commit: 4fe827cf353b884942e2cae067a6fb063e5d2f0f

# Find out what the emulator holds for read replicas, Multi-AZ DB clusters, global clusters, proxies, option groups, exports and blue/green deployments

> Identified against commit `4fe827cf353b884942e2cae067a6fb063e5d2f0f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio shows none of RDS's further resources, and what the emulator does for them is not known beyond that their operations answer.

## Evidence

aws-emulator 1.0.533 (commit ec5f6fba), called directly while issue 573 was planned (its plan's probes 1 to 6; the requirement of issue 573, "What the emulator supports", "The rest answers"): their operations answer and were not probed further. The requirement of issue 573 lists this as task 12 of its task table, supported by the emulator and left out of that issue (PM decision of 2026-11-20: tasks 5 to 12 are filed at the close). The older issues 411 (option groups), 413 (proxies) and the read replicas of 408 planned these the old way.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/rds`.
3. Look for the task: no screen or action offers it.

## Expected

- For each resource, what the emulator answers is written down from direct calls: what works with state, what is accepted unchecked, what is 501.
- Each resource a developer has a local task with becomes an issue of its own, in order of use; the others are named as no task.

## Out of scope

- Building any of these screens.
