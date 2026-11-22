Issue-Id: 633
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ec2.launch-t3-micro-1c|missing-refusal
Issue-Check-Ids: studio.ec2-launch-an-instance-reaches-the-emulator
Issue-Commit: 1c616a14b338e18f00471cd8471ad758de132e25

# Reconcile the EC2 launch refusal check in us-east-1c with the emulator

> Identified against commit `1c616a14b338e18f00471cd8471ad758de132e25`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

One of the eight EC2 launch criteria failed on Ubuntu with emulator 1.0.578. The scenario selected t3.micro and the default subnet in us-east-1c. It expected the launch form to display an Unsupported refusal, but the alert did not appear within 20 seconds. The log does not establish whether the emulator accepted the launch, returned another error, or Studio failed to display a refusal.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/45078111137 selected every service because of shared integration paths, including tests/integration/engine/Cargo.lock. Saved output: .pm/run/ci-1c616a14.log (the refusal in the form; expected visible; element not found). This was the only failed check. The run completed its integration step in 20 minutes 55 seconds.

## Steps to Reproduce

1. On a fresh loopback emulator matching the failed run, inspect the result of launching t3.micro into the default subnet in us-east-1c.
2. Exercise the same configuration through the Studio launch form, compare the result and resource state, and inspect the named scenario's refusal expectation.

## Expected

Studio accurately reports the emulator's launch result. A refusal preserves the form entries and shows the returned error; the integration scenario exercises a verified refusal and checks the corresponding emulator state.

## Out of scope

Changes to SQS, RDS or relay signing, and requests to real AWS.
