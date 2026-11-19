Issue-Id: 538
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|area.dialog-backdrop-press|drops-entered
Issue-Check-Ids:
Issue-Commit: f4a4da3728c1d7f0b9eef60c1e35027e11ce80ac

# Ask before a press on a dialog's backdrop drops what was entered in it

> Identified against commit `f4a4da3728c1d7f0b9eef60c1e35027e11ce80ac`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A dialog of the AWS area that holds what a developer entered closes on a press on its backdrop and drops it, with no
question: Lambda's "Edit environment variables" with rows added closes on any dismissal
(`studio/src/providers/aws/area/services/lambda/components/edit-variables-dialog.tsx`, about line 32: `onClose()`
unless a save is in flight). A create form's "Cancel" asks "Discard what you entered?" once anything differs
(`studio/references/aws-area.md`, "What earlier critiques found", entry 5); a dialog that is a form does not, and its
backdrop is one stray press away. Since issue 531 the backdrop also covers Studio's bar, so a press meant for the bar
is such a press. Its own stated behavior is entry 5's reason: work entered is not dropped by one press.

## Evidence

- The impeccable critique of issue 531, point `final`, on the built app of `feat/531` at `38c9937`
  (`.pm/issue-531/review-final.md`, kept under `.pm/archive/531/`): its first P2.
- Issue 531's probe 4 on the built app of `main` at `3035646` (`.pm/issue-531/probe/probe-4.log`): with one row added
  and its key typed, a press on the backdrop at (8, 400) closes the dialog at 390x844 and 1280x800, and the dialog
  opened again shows no row.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a Lambda function.
2. Open `/aws/lambda/functions/function/{name}?tab=configuration`, choose "Edit" of "Environment variables", add a row
   and type a key.
3. Press on the dimmed page beside the dialog: the dialog closes; opened again it shows no row.

## Expected

- With something entered that differs from what the dialog showed when it opened, a press on its backdrop does not
  drop it unasked: the dialog stays, or it asks before it discards.
- With nothing entered, a press on the backdrop closes the dialog as today.

## Out of scope

Esc, the close control and the dialog's own "Cancel"; dialogs that hold nothing entered (a confirmation, a list's
"Preferences").
