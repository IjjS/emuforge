Issue-Id: 563
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2.console-output|not-built
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Show an EC2 instance's console output

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

An instance's page (issue 553) does not show the console output the emulator gives.

## Evidence

aws-emulator 1.0.531 (commit 64bde3bf), called directly while issue 553 was planned (its plan's probes 1 to 6): `GetConsoleOutput` answers a synthesized boot log naming the instance's id, type, image, zone and addresses, for running, stopped and terminated instances. The requirement of issue 553 lists this task in its task table as supported by the emulator and left out of that issue (PM decision of 2026-11-20: each later task is filed as its own issue).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Open `/aws/ec2`.
3. Look for the task: no screen or action offers it.

## Expected

- The instance's page shows the log as text and reads it again on request.

## Out of scope

- The console screenshot.
