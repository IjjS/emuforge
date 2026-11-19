Issue-Id: 512
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb.items|filter-by-attribute
Issue-Check-Ids: studio.dynamodb-filter-a-scan-by-attribute-values studio.dynamodb-filter-a-query-and-a-refused-filter studio.dynamodb-filtered-pages-say-what-they-read
Issue-Commit: 041c721196b7be93e005837f6a10ba3b9ba9a8bc

# Filter a DynamoDB table's explored items by attribute values

> Identified against commit `041c721196b7be93e005837f6a10ba3b9ba9a8bc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 496 built DynamoDB's tasks 1 to 5 (its `requirement.md`, "Tasks"). Task 6, filtering the explored items by
attribute values, is held by no issue: the "Items" tab of `/aws/dynamodb/tables/table/<name>` scans a table or
queries it by key, and has no way to keep only the items whose other attributes match. The emulator supports it:
`Scan` and `Query` take a `FilterExpression`. The reference is the same request sent straight to the emulator.

## Evidence

Issue 496's probes on aws-emulator 1.0.515 (`.pm/issue-496/requirement.md`, "FilterExpression", from probe-1 §4 of
that issue: `Count` 0, `ScannedCount` 5, a `LastEvaluatedKey`): `FilterExpression` works on `Scan` and `Query`; `Limit` counts the items read before the
filter, so a page can hold no item while a `LastEvaluatedKey` says more remain. The built "Items" tab
(`studio/src/providers/aws/area/services/dynamodb/components/items-tab.tsx`) sends neither.

## Steps to Reproduce

1. Create a table with a few items that differ in a non-key attribute.
2. Open its page in Studio, "Items".
3. Look for a way to show only the items whose attribute has a given value: there is none.

## Expected

- "Items" takes one or more conditions on attributes (name, comparison, typed value) for a scan and for a query, and
  sends them as a `FilterExpression` with names and values as placeholders.
- A page the filter leaves empty while more remain says so and still offers the next page.
- The emulator's refusal of a condition is shown with its code and message.

## Out of scope

The key condition of a query (built). PartiQL (issue 335).
