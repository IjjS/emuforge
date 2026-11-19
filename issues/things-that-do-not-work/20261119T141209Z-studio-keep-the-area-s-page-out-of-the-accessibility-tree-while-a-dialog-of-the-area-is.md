Issue-Id: 539
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|area.dialog-content-behind|accessibility-tree
Issue-Check-Ids:
Issue-Commit: f4a4da3728c1d7f0b9eef60c1e35027e11ce80ac

# Keep the area's page out of the accessibility tree while a dialog of the area is open

> Identified against commit `f4a4da3728c1d7f0b9eef60c1e35027e11ce80ac`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

While a dialog of the AWS area is open, the area's page behind it stays in the accessibility tree: Cloudscape's `Modal`
sets no `aria-modal` on its dialog and hides nothing behind it, and the area adds nothing
(`studio/src/providers/aws/area/area-layout.tsx`, `useModalReport`). Keyboard focus is trapped in the dialog, but a
screen reader's own navigation leaves it into the page's content, which cannot be used meanwhile. Since issue 531
Studio's bar is inert while a dialog is open, so the area's own page is what is left reachable. A dialog's stated
behavior is that nothing behind it can be used (`studio/references/aws-area.md`, "Inside the area: Cloudscape": "A
dialog traps focus").

## Evidence

- The impeccable critique of issue 531, point `final`, on the built app of `feat/531` at `38c9937`
  (`.pm/issue-531/review-final.md`, kept under `.pm/archive/531/`): its second P2, "pre-existing, Cloudscape".
- `studio/node_modules/@cloudscape-design/components/modal/internal.js` (3.0.1407) holds no `aria-modal`, `aria-hidden`
  or `inert`.

## Steps to Reproduce

1. Start a fresh emulator and Studio; open `/aws/s3/buckets` and choose "Preferences".
2. Read the accessibility tree of the page (a screen reader's browse mode, or the browser's accessibility inspector):
   the list's heading, table and controls are still in it beside the dialog.

## Expected

- While a dialog of the area is open, nothing of the area's page outside the dialog is in the accessibility tree, and
  nothing of it can be focused or pressed.
- Once the dialog is gone the page is as it was, focus on what opened the dialog.

## Out of scope

Studio's bar (inert since issue 531); Studio's own dialog (`ui/dialog.tsx`), which already makes the rest of the
document inert.
