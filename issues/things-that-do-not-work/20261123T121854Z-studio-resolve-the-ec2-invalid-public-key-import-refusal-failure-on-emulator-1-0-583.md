Issue-Id: 635
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ec2-key-import|invalid-key-refusal-583
Issue-Check-Ids: studio.ec2-key-pair-create-import-delete
Issue-Commit: 3f8d3ddbfdde7a039794e7af980457a049bead32

# Resolve the EC2 invalid public key import refusal failure on emulator 1.0.583

> Identified against commit `3f8d3ddbfdde7a039794e7af980457a049bead32`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The main check on emulator 1.0.583 timed out waiting for the EC2 import form to display InvalidKeyPair.Format. The origin of the difference is unverified.

## Evidence

Main record output/checks/2026-11-23T210429.json and .pm/run/main-image-1.0.583.log. The verdict in output/integration/verdicts/studio.ec2-key-pair-create-import-delete.json names S9 as the sole failing criterion of nine; the visible-refusal assertion timed out after 20 seconds.

## Steps to Reproduce

Run studio.ec2-key-pair-create-import-delete against emulator 1.0.583. Its S9 submits an unused name and the literal text “not a key” through Import a public key.

## Expected

The form shows the emulator refusal and preserves the confirmed absence of a key pair with that name. Verify the actual emulator response before deciding where a correction belongs.

## Out of scope

Other EC2 forms and unrelated integration checks.
