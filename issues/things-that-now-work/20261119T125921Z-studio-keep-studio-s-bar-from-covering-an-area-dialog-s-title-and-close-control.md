Issue-Id: 531
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|area.dialog-under-studio-bar|layering
Issue-Check-Ids: studio.aws-area-dialog-is-above-studio-bar
Issue-Commit: a6f561bdbfba15b2c8293eccac62ed66e8e0684a

# Keep Studio's bar from covering an area dialog's title and close control

> Identified against commit `a6f561bdbfba15b2c8293eccac62ed66e8e0684a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

At a width of 390 Studio's bar covers the title and the close control of a tall dialog of the AWS area, which is where
focus lands when the dialog opens; at every width the bar stays above the dialog's backdrop and can be clicked while
the dialog is open. Seen on Lambda's "Edit environment variables"; the cause is in the shared frame, not in Lambda:
`.st-area { isolation: isolate }` (`studio/src/ui/base.css`, about line 128) keeps Cloudscape's modal (z-index 5000)
under `header.st-bar` (sticky, z-index 10). A dialog's own stated behavior is that it is above everything else and
nothing behind it can be used.

## Evidence

The impeccable critique of issue 516, point `final` round 2, on the built app of `feat/516` at `7b260c5` against the crit's own emulator (`.pm/issue-516/review-final.md`, kept under `.pm/archive/516/`; snapshot `studio/.impeccable/critique/2026-11-19T12-58-37Z__src-providers-aws-area-services-lambda.md` in the worktree).

- Its P2 "[studio/src/ui/base.css:128; outside the issue, shared frame, unchanged by 516]".
- Capture `output/captures/final-r2-states/bar-over-dialog-390.png` of the worktree `emuforge-516` (not kept after
  the worktree is removed; the steps below show it again).
- Esc, "Cancel" and "Save" still work.

## Steps to Reproduce

1. Start a fresh emulator and Studio at a viewport of 390x844; create a Lambda function.
2. Open `/aws/lambda/functions/function/{name}?tab=configuration` and choose "Edit" of "Environment variables"; add
   rows until the dialog is taller than the viewport.
3. The dialog's title and "Close" are under Studio's bar; the bar's controls can be clicked.

## Expected

- With any dialog of the area open, at 390 and at 1280, its title and close control are visible and not covered.
- With a dialog open, no control of Studio's bar can be clicked or focused.

## Out of scope

The dialogs' own content and names; Lambda's screens.
