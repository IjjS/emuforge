Issue-Id: 543
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|iam.role-and-policy-screens|critique-p2-p3
Issue-Check-Ids:
Issue-Commit: 376650f4753bce85d4d53ee377dec0d32c1833e0

# Make IAM's role and policy screens easier to read and act on, as the critique of issue 535 found

> Identified against commit `376650f4753bce85d4d53ee377dec0d32c1833e0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The impeccable critique of issue 535's built screens (point `final`, 25/40) left five P2 and three P3 findings on
IAM's role and policy screens that issue 535 did not fix. There is no console to match here: each is judged against
the screen's own task (`studio/references/critique.md`). All paths are under
`studio/src/providers/aws/area/services/iam/`.

1. `components/permissions-tab.tsx`: the visible labels "Edit" and "Delete" of "Permissions policies" repeat the
   role's own "Edit" (of "Summary") and "Delete" (of the header); and "Detach", "Edit" and "Delete" are unavailable
   with no reason while no row is chosen, where `components/policy-sections.tsx` gives one.
2. `components/policy-sections.tsx`, `pages/policy-page.tsx`: "Show document" in "Versions" changes the section
   "Policy document" above the table, which is off the screen at 390 wide, and no row is marked as the one shown.
3. `components/document-editor.tsx`, `components/policy-document.tsx`: a document is edited in a proportional
   text area with no way to format it; no document has a copy control; a managed policy's document shows as one
   wrapped line.
4. `components/trust-tab.tsx`, `format.ts`: "Trusted entities" runs the principals into one list separated by
   commas and does not say that a statement holds a `Condition`.
5. `components/role-sections.tsx`: "Last activity" always reads "-", though the emulator never records it.
6. `pages/role-page.tsx`: "Role not found" leaves the opening quote of the name at a line's end at 390 wide.
7. `pages/create-policy-page.tsx`: the container "Policy document" has no header below the headed "Policy details".
8. `components/policy-sections.tsx`: the header of "Versions" does not say how many of the emulator's five
   versions are held.

The critique's second round (`review-final-r2.md`) added, on the same screens:

9. The four editors ask "Discard what you entered?" in two ways (the trust editor unmounts its dialog while asking,
   the others stack two), name the close button three ways ("Close modal", "Close dialog", "Close"), the trust
   editor's "Cancel" looks available during a save, focus after "Keep editing" lands on the close button in the
   trust editor, and "What you entered on this page is not kept." speaks of a page inside a dialog.
10. `components/policy-sections.tsx`, `components/edit-policy-dialog.tsx`: "Edit" sits under "Policy document",
    which may show a version that is not the default, but always starts from the default's text.
11. `components/permissions-tab.tsx`: at 390 wide the column "Document" with "Show document" is off the screen in
    the table that scrolls sideways.
12. `components/permissions-tab.tsx`: after "Detach" or "Delete" the focus returns to a button the read then makes
    unavailable, and falls to the document's body.
13. `providers/aws/area/components/confirm-dialog.tsx`: a delete in flight shows no "Deleting" text;
    `components/policy-sections.tsx`: "Select a version first" lacks its period;
    `components/edit-policy-dialog.tsx`: the editor's not-found text reuses "A role can still name it.".

## Evidence
`.pm/issue-535/review-final.md` and `review-final-r2.md` ("## P2", "## P3"), with the critique's snapshot
`studio/.impeccable/critique/2026-11-19T15-05-12Z__src-providers-aws-area-services-iam-pages.md` in the worktree of
issue 535 and its captures under `output/captures/final/` and `final-empty/` there (ignored paths: capture again
with `pm-capture` on the built app). For 5: issue 535's probe 2 (`.pm/issue-535/probe/probe-2.log`), where
`GetRole` never reports `RoleLastUsed` after the role was assumed.

## Steps to Reproduce
1. Start an emulator and the built Studio; make a role trusted by two services, one statement with a `Condition`,
   with an attached customer managed policy of two versions and an inline policy.
2. Open `/aws/iam/roles/details/<role>`: read the actions of "Permissions policies" with no row chosen (1) and
   "Last activity" in "Summary" (5).
3. Open the same page with `?tab=trust`: read "Trusted entities" (4).
4. Open `/aws/iam/policies/details?arn=<the policy's ARN>` at 390 wide and choose "Show document" of the version
   that is not the default (2, 8); choose "Edit" and read the editor (3).
5. Open `/aws/iam/roles/details/<a name no role has>` at 390 wide (6) and `/aws/iam/policies/create` (7).

## Expected
- The actions of "Permissions policies" on an inline policy are told apart from the role's own by their visible
  labels, and each unavailable action gives its reason.
- Choosing a version's document shows it where the choice was made, or moves the view and the focus to it, and the
  version shown is marked.
- A document is edited and shown in a fixed-width face over indented lines, can be formatted, and can be copied.
- "Trusted entities" lists one principal a row and marks a statement that holds a `Condition`.
- "Last activity" is not shown as a value the emulator could hold, or says the emulator does not record it.
- At 390 wide the quotes of "Role not found" stay with the name.
- "Policy document" of "Create policy" has a heading of level 2.
- The header of "Versions" tells the number held against the limit.
- The editors ask to discard in one way, name their close button alike, make "Cancel" unavailable during a save,
  return the focus to the document's field after "Keep editing", and word the question for a dialog.
- "Edit" of a policy starts from the version shown and says so, or is unavailable with a reason while another
  version than the default is shown.
- At 390 wide "Show document" of a role's policy is reachable without scrolling the table sideways.
- After a policy is detached or deleted the focus is on a control or heading of "Permissions policies".
- A delete in flight says so; "Select a version first." ends with its period; the policy editor's not-found text is
  its own.

## Out of scope
- The sentence "It starts without any each time it restarts." of the policy list (the critique's P3): its wording
  is fixed by issue 535's requirement and stays (`.pm/issue-535/decisions.md`, Review decisions).
- An editor shared by the whole AWS area for policy text (issue 475).
