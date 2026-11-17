Issue-Id: 470
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|aws-area-table-free-text-cell|breaking
Issue-Check-Ids:
Issue-Commit: a1a1fece6a565a01a01e4936133b6c85e1f5d487

# Give the area one way to keep a free-text table cell's longest word out of its column's width

> Identified against commit `a1a1fece6a565a01a01e4936133b6c85e1f5d487`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 467 (R6) makes the area's `components/value-text` the one way a value breaks, and says a service keeps no
breaking rule of its own. Free text (`kind="text"`) breaks with `overflow-wrap: break-word`, so in a Cloudscape
table (automatic table layout) an unbroken word of free text sets its column's minimum width: a Lambda description
of 256 characters without a space widened the "Description" column past a 390-wide viewport. The area offers no way
to keep such a word out of the column's width, so Lambda keeps its own rule in
`studio/src/providers/aws/area/services/lambda/pages/function-list-page.css` (`.aws-lambda-description-cell`:
`contain: inline-size; min-inline-size: 10ch`), and S3 and IAM will need the same for any free-text column. The
reference, the AWS Lambda console's function list, breaks a long description inside its cell without widening the
column.

## Evidence

- `.pm/issue-467/review-impl-s2-r1.md`, P2: the Lambda description cell's sizing is a service-owned rule that
  decides how a long free-text word breaks in a table cell.
- `studio/src/providers/aws/area/components/value-text.css`, the rule of `.aws-area-value-text`: "`break-word`
  rather than `anywhere`, so a table's column is never narrower than the text's longest word".
- With the Lambda rule, `studio.lambda-function-screens-keyboard-and-layout` passes on `feat/467-s2` a1a1fec
  (`output/checks/checks-run5.json` of that worktree); the rule is the only thing in the list that keeps the
  256-character word out of the column's width.

## Steps to Reproduce

1. Make a Lambda function directly whose description is 256 characters without a space.
2. Remove the class `aws-lambda-description-cell` from the list's "Description" cell and build Studio.
3. Open `/aws/lambda/functions` at 390 wide under a filter of that function's name.
4. The "Description" column is as wide as the 256-character word; its cell ends past the viewport.

## Expected

- The area's value component offers free text for a table cell whose longest word does not set the column's width,
  while a word of up to 10 characters stays whole.
- Lambda's list uses it, and `function-list-page.css` holds no rule of its own; no service stylesheet sets
  `contain` or a minimum width to decide how a value breaks.
- `studio.lambda-function-screens-keyboard-and-layout` and `studio.lambda-values-break-where-they-can-be-read` still
  pass.

## Out of scope

- How names and addresses break (already the area's).
- Cloudscape's own components and their padding or fonts.
