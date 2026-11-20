Issue-Id: 567
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ec2.terminate-under-protection|critique-p2
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Make Terminate unavailable while an EC2 instance's termination protection is on

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On an instance's page that shows "Termination protection" "On", "Terminate" is offered and asks for the typed confirmation; only then does the emulator refuse (`OperationNotPermitted`). The second critique of issue 553 found it (P2). Fixing it changes a confirmed criteria line of `studio.ec2-stop-start-reboot-terminate-an-instance`, so it was not changed inside issue 553.

## Evidence

`.pm/issue-553/review-final-r2.md`, P2 line 1 (`components/instance-actions.tsx`, `pages/instance-page.tsx`); the check line 'S3 of P → "Termination protection" "On"; "Terminate", type `terminate`, "Terminate" → the emulator's `OperationNotPermitted`' in `tests/integration/studio/ec2-instances.spec.ts`.

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Follow the evidence's screen as described above.

## Expected

- On the instance's page, "Terminate" is unavailable with the reason "Termination protection is on." while the value read is on, and available while it is off or unknown; the check's line is changed on the pm's decision.

## Out of scope

- The instances list, which does not read the protection.
