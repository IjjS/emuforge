Issue-Id: 518
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|dynamodb.items-filter|critique-p2
Issue-Check-Ids:
Issue-Commit: 6940df2804cffd22f9ad0255198f5f52736cff24

# Tighten the DynamoDB items filter: one-line rows, filtered columns first, announced states

> Identified against commit `6940df2804cffd22f9ad0255198f5f52736cff24`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 512 built the filter of a table's "Items" (`/aws/dynamodb/tables/table/<name>`). The impeccable critique of the
built app, point `final` round 2 (25/40, no P0 or P1), left five P2 findings that issue 512 did not fix. Every action
of the filter works; these are rough edges of its layout and of what it tells. The reference is the critique alone
(`studio/references/critique.md`); nothing here is measured against the AWS console.

1. At 1280 wide a condition's row is three lines, "Remove" alone on the last: the filter's group is a few pixels
   under the width at which Cloudscape's `AttributeEditor` keeps a row on one line.
2. With a filter applied, the columns of the attributes it names sit in code point order among the others and can be
   past the right edge at 1280, so the values the filter was about are not seen without scrolling the table.
3. The filter's description, its help and "No conditions. Every item read is shown." are always shown, also on a
   table without items; at 390 wide the first viewport ends inside them.
4. "Changed since the last run. Run to apply." and a refused read are not announced; a "Run" stopped by the filter's
   own checks leaves focus on "Run" instead of the first field that failed; a refusal does not say where to correct.
5. "More items remain: go to the next page." names a control that is not in the message: the developer has to find
   "Next page" in the table's header.

And one finding of issue 512's review of the whole (`review-impl-r1.md`, P2):

6. The refused filtered read (`components/items-tab.tsx`, `Body`, case `refused`) copies the markup of the area's
   shared `ReadFailure` (`providers/aws/area/components/failure-states.tsx`) to give its action another label and
   handler ("Run", the request as the fields now hold it). The two match today; a later change of `ReadFailure` would
   not reach the copy, which already leaves out its "Connection status" link.

## Evidence

`.pm/archive/512/` once issue 512 is archived (until then `.pm/issue-512/`): `review-final.md`, round 2, "P2", each
finding with its file and lines; `critique-scores.json` (final, round 2: 25/40, P0 0, P1 0). The snapshot the
findings come from: `studio/.impeccable/critique/2026-11-19T11-24-40Z__src-providers-aws-area-services-dynamodb.md`
in issue 512's worktree. Files: `studio/src/providers/aws/area/services/dynamodb/components/items-filter.tsx`,
`components/items-tab.tsx` (`columnNames`, the header, the empty state), `components/items-explorer.ts`.

## Steps to Reproduce

1. Create a table with a partition key and about twenty items that hold a dozen attributes, among them `status`.
2. Open its page in Studio at 1280 wide, "Items", "Add condition": the row takes three lines (1); the description
   and help stand above it whatever the table holds (3).
3. Set `status` "Equal to" String to a value some items hold, "Run": the column `status` is among the last (2).
4. Change the value and do not run: "Changed since the last run. Run to apply." appears and is not announced (4).
5. Set items per page so that a page matches none while more remain: the message says to go to the next page and
   holds no control (5).

## Expected

- At 1280 wide a condition is one row, with "Remove" in it; at 390 the rows are told apart.
- With a filter applied, the columns of the attributes its conditions name follow the key columns, in the
  conditions' order; without a filter the columns are as today.
- The filter's help is shown only once a condition exists, or on demand; the description stays.
- "Changed since the last run. Run to apply." and a refused read are announced once, politely; a "Run" stopped by a
  check moves focus to the first field with a message; a refused filtered read says to correct the conditions and
  run again.
- A page that matched none while more remain offers "Next page" in its message, the same move as the pagination's.
- The refused filtered read is shown by the area's `ReadFailure` itself, which takes the action's label and handler;
  the Items tab holds no copy of its markup, and every other use of `ReadFailure` shows what it shows today.

## Out of scope

The critique's four P3 of the same round (the counter after "filtered by {n} conditions", a line break of the
description at 390, the placeholders of fields a comparison does not use, a client check of an empty Number):
recorded as not adopted in issue 512's `decisions.md`. Any change of what the filter sends.
