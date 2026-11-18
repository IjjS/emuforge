Issue-Id: 462
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|area-modal|modal-root-remounts-on-render
Issue-Check-Ids: studio.s3-bucket-list-preferences-keeps-focus-across-a-connection-check
Issue-Commit: 4e370b416a4d8d80c9d9548eae82806e3f8fbc69

# Keep an open dialog of the AWS area in place while it re-renders

> Identified against commit `4e370b416a4d8d80c9d9548eae82806e3f8fbc69`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`AreaModal` (`studio/src/providers/aws/area/components/area-modal.tsx`) builds a new `getModalRoot` function on
every render and hands it to Cloudscape's `Modal`. Cloudscape's portal
(`@cloudscape-design/component-toolkit/internal/portal`) re-runs its layout effect whenever `getContainer` changes:
it removes the old container and asks for a new one. So every re-render of an open `AreaModal` (a keystroke in a
field it holds, a new answer of the connection check every 5 seconds, any state change of the page around it)
moves the dialog into a new element and remounts everything inside it. A user typing into a field of the dialog
loses focus after the first character, and Cloudscape's focus trap starts again. The reference, the AWS console's
"Delete functions" dialog (the owner's capture `docs/aws-console/lambda/03-event-functions`), keeps its field and
its focus while the user types `confirm`.

The S3 bucket list builds the modal root of its "Preferences" the same way, inline in a render
(`studio/src/providers/aws/area/services/s3/pages/bucket-list-page.tsx`, `useAreaModalRoot`); that dialog was not
tried.

## Evidence

Issue 84's `s2` met it in the delete dialog of the Lambda function list. The unit case "typed one character at a
time: the field stays the same element, keeps focus and holds what was typed"
(`studio/src/providers/aws/area/services/lambda/components/delete-functions-dialog.test.tsx`) passes with a modal
root whose functions keep their identity (`services/lambda/components/modal-root.ts`), and fails when the dialog is
rendered with `AreaModal` instead: `AssertionError: expected false to be true` at `input.isConnected` after the
second character (log `output/logs/area-modal-remount.log` of the worktree `emuforge-84-s2`). With `AreaModal`,
the case "Enter with `confirm` typed does what "Delete" does" also failed: the field the case had found was no
longer in the document, so its key press reached nothing.

## Steps to Reproduce

1. Render any `AreaModal` that holds a Cloudscape `Input` inside the AWS area (as the area's unit cases render it).
2. Focus the input and change its value twice, letting the microtask queue run between the changes.
3. Read whether the input element found before the first change is still connected and focused.

## Expected

- While an `AreaModal` is open, a re-render of it or of the page around it leaves its root element and every
  element inside it in place: an input found before the re-render is still in the document and still has focus.
- A user can type a word into a field of an open dialog of the area one character at a time.
- The same holds for the "Preferences" dialog of the S3 bucket list while the connection check re-renders the page.

## Out of scope

- Which dialogs the area has, their content and their words.
- The Lambda screens' own modal root (`services/lambda/components/modal-root.ts`), which issue 84 made for its
  dialogs; once `AreaModal` keeps its dialog in place, moving the Lambda dialogs back to `AreaModal` is that
  issue's follow-up, not this one.
