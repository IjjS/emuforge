Issue-Id: 532
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|lambda.function-page|critique-516-p2-p3
Issue-Check-Ids:
Issue-Commit: a6f561bdbfba15b2c8293eccac62ed66e8e0684a

# Fix what the critique of issue 516 left on Lambda's function page: narrow widths, focus after Invoke, the variables' order

> Identified against commit `a6f561bdbfba15b2c8293eccac62ed66e8e0684a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

What the critique of issue 516 found on Lambda's function page and did not hold the issue up for (P2 and P3, no P0 or
P1). The screens work; these are rough edges, most of them at a width of 390:

- At 390 every tab's content starts below the fold: "Function overview" fills the first screen, and choosing a tab
  moves only the underline.
- After an answer on "Test" focus stays on "Invoke", which the scroll to the result has moved out of view; a second
  invocation shows no in-flight state beside the earlier result.
- "General configuration" keeps two columns at 390, so the role's ARN breaks over five lines.
- The environment variables are shown in the order of the emulator's answer, which differs between loads, in the
  section and in the dialog's rows.
- The Edit dialogs open with focus on "Close"; "Add variable" leaves focus on itself; each row's inputs are named
  only "Key" and "Value".
- "as the emulator returned it" is said in both outputs' descriptions; "Response" and "Log tail" have no copy control.
- The delete dialog's close control is named "Close modal" while the Edit dialogs say "Close".
- "Function not found" breaks after the opening quote of the name.

## Evidence

The impeccable critique of issue 516, point `final` round 2, on the built app of `feat/516` at `7b260c5` against the crit's own emulator (`.pm/issue-516/review-final.md`, kept under `.pm/archive/516/`; snapshot `studio/.impeccable/critique/2026-11-19T12-58-37Z__src-providers-aws-area-services-lambda.md` in the worktree).

- Its P2 1 to 4 and P3 1 to 4, each with its file and line (`components/function-sections.tsx:59-78`,
  `pages/function-page.tsx:64-71`, `components/test-tab.tsx:56, 116`, `components/invoke-result.tsx`,
  `components/configuration-tab.tsx:96`, `components/edit-variables-dialog.tsx:103-129`,
  `components/delete-functions-dialog.tsx:119`, under `studio/src/providers/aws/area/services/lambda/`).
- Measured there: on load at 390x844 "Invoke" is at y=866; after an answer "Invoke" is at y=-45 to -125; three
  reloads of "Configuration" gave three orders of the same variables.

## Steps to Reproduce

1. Start a fresh emulator and Studio at a viewport of 390x844; create a Lambda function and give it three environment
   variables on "Configuration".
2. Open the function's page: "Invoke" is below the fold. Choose "Invoke": focus is on a control out of view.
3. Reload "Configuration" several times: the variables change their order.

## Expected

- At 390 a tab's content is in view when the page opens and when a tab is chosen.
- After an invocation the focused control is in view, and a second invocation shows that it is running.
- At 390 the role's ARN of "General configuration" is readable in one column.
- The environment variables keep one order across loads, in the section and in the dialog.
- Opening an Edit dialog puts focus on its first field; "Add variable" puts it on the new row's key; each row's
  inputs are named with their row.

## Out of scope

The bar over a dialog (its own issue, filed with this one); the position in the invalid-JSON message, recorded as not adopted in issue 516's decisions.
