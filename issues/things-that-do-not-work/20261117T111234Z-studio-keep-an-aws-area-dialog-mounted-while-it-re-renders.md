Issue-Id: 458
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|aws-area.modal-root|remounts-on-render
Issue-Check-Ids:
Issue-Commit: efff0eca145f2583e47f3bc16c0cc6dafa5aab7d

# Keep an AWS area dialog mounted while it re-renders

> Identified against commit `efff0eca145f2583e47f3bc16c0cc6dafa5aab7d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`AreaModal` (`studio/src/providers/aws/area/components/area-modal.tsx`), which every modal of the AWS area is meant to
use, makes a new `getModalRoot` function on each render. Cloudscape's portal
(`@cloudscape-design/component-toolkit/internal/portal`) makes a new container whenever `getContainer` or
`removeContainer` changes, so each re-render of a dialog (a key typed into its field, a button that starts loading)
removes the dialog's content and mounts it again in a new container. Focus leaves the field after each key, and
what Cloudscape holds inside the dialog (its focus lock, the element to give focus back to) starts over. The S3
bucket list's own `useAreaModalRoot` for "Preferences"
(`studio/src/providers/aws/area/services/s3/pages/bucket-list-page.tsx`, line 246) builds both functions on each
render in the same way. The reference is Cloudscape's `Modal` as published: one dialog that stays mounted while
it is open, so typing into its field keeps focus there (`studio/AGENTS.md`: "A dialog traps focus, closes on Esc,
and returns focus to what opened it").

## Evidence

- `area-modal.tsx` line 18 defines `getModalRoot` inside the component body; the portal's layout effect depends on
  `[container, getContainer, removeContainer]` (`studio/node_modules/@cloudscape-design/component-toolkit/internal/portal/index.js`,
  line 63) and returns a cleanup that removes the old container.
- Seen in issue 82's unit `s2` (worktree `emuforge-82-s2`, commit `efff0ec`): the delete dialog of the IAM role list
  built on `AreaModal`, rendered in the area with Vitest. After "Delete" in the dialog set the mutation pending, the
  `role="dialog"` element found before was no longer in the document (`dialog.isConnected` was `false`) and the
  dialog's primary button found afresh carried no loading state of the element under test. Unit `s2` now gives its
  dialog a root whose functions keep their identity (`services/iam/components/page-parts.tsx`,
  `useAreaModalRoot`), and its case "typing keeps the field, its focus and the dialog" passes with it.

## Steps to Reproduce

1. Render a component that holds a text in its own state and renders `<AreaModal visible>` with an `Input` bound to
   that text, inside the AWS area (so `AreaRootContext` holds the area's root).
2. Focus the `Input` and type one character.
3. Read whether the `role="dialog"` element found before typing is still connected and whether the `Input` still
   has focus.

## Expected

- A dialog of `AreaModal` that re-renders while open keeps the same `role="dialog"` element and the same field
  element, and focus stays in the field while keys are typed.
- The S3 bucket list's "Preferences" dialog keeps the same `role="dialog"` element while a page size is chosen in it.
- Once `AreaModal` keeps its identity, the IAM dialogs (the role list's "Delete", and any later one built on
  `services/iam/components/page-parts.tsx` `useAreaModalRoot`) and the S3 "Preferences" dialog use `AreaModal`, and
  the service folders' own `useAreaModalRoot` copies are removed; each dialog's own cases still pass.

## Out of scope

- Any change of what a dialog shows or of where its root is (the area's root, never `document.body`).
