Issue-Id: 544
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.dialog-refusal|not-announced
Issue-Check-Ids:
Issue-Commit: 95a6fea439c3ee7fbbb5ac5636a3632a9a7a0473

# Announce a refusal shown inside a dialog of the AWS area to a screen reader

> Identified against commit `95a6fea439c3ee7fbbb5ac5636a3632a9a7a0473`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A dialog of the AWS area that stays open on a refusal shows the refusal as a Cloudscape `Alert` inside the dialog.
That element has `role="group"` and is no live region, and the focus stays where it was, so a screen reader says
nothing when a save is refused: the user hears no result of the action. Found by the critique of issue 535 on IAM's
editors ("Add inline policy", "Edit" of an inline policy, "Edit trust policy", "Edit" of a policy); the critique read
the dialogs of Lambda, S3 and DynamoDB as doing the same, so the pattern is the area's and not one service's. The
reference is the area's own rule that a result of an action is told (`studio/references/aws-area.md`); a page's
`Flashbar` is announced, a dialog's alert is not.

## Evidence
`.pm/issue-535/review-final-r3.md`, "## P2", second finding, with the code it names under
`studio/src/providers/aws/area/services/iam/components/`: `inline-policy-dialog.tsx:70-76,260`,
`edit-trust-policy-dialog.tsx:120-124`, `edit-policy-dialog.tsx:145-149` (commit `95a6fea`).

## Steps to Reproduce
1. Start an emulator and the built Studio; make a role directly.
2. Open `/aws/iam/roles/details/<role>?tab=trust`, choose "Edit", replace the text by `{}` and choose "Save changes".
3. The emulator refuses with `MalformedPolicyDocument` and the dialog shows it; watch the live regions of the
   document: none comes to hold the refusal, and the focus is still on the button.

## Expected
- A refusal shown inside a dialog of the AWS area is announced: a live region that was on the page before the
  refusal comes to hold its text, or the focus moves to the alert.
- The same holds for every service's dialog that stays open on a refusal.

## Out of scope
- The wording of a refusal and where in the dialog it stands.
- The page's `Flashbar`, which is announced already.
