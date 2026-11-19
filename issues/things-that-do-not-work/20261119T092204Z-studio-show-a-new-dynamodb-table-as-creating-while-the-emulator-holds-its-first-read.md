Issue-Id: 515
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb.table-page|creating-during-the-emulator-hold
Issue-Check-Ids:
Issue-Commit: 041c721196b7be93e005837f6a10ba3b9ba9a8bc

# Show a new DynamoDB table as "Creating" while the emulator holds its first read

> Identified against commit `041c721196b7be93e005837f6a10ba3b9ba9a8bc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

After "Create table" Studio opens the new table's page, which reads the table with `DescribeTable`. aws-emulator
1.0.515 holds a `DescribeTable` of a table being created until the table is `ACTIVE`, about 3 s, so the page shows
"Loading table" for those seconds and then "Active"; it never shows "Creating", although `CreateTable` itself
answered `CREATING` and the Flashbar says "Table {name} is being created.". Issue 496 left this as it is on the
pm's decision of 2026-11-19 (its `decisions.md`): the check asks only for "Active" without a reload. Wanted here:
the page shows the table as "Creating", from `CreateTable`'s own answer, until its first read answers.

## Evidence

`.pm/issue-496/probe/probe-7.log`: `DescribeTable` sent 16 ms after `CreateTable` answered `CREATING` answered
`ACTIVE` after 2946 ms; later ones in about 350 ms. `.pm/issue-496/logs/checks-7.log` and the check's log: the
table page shown at 1.5 s, its tabs at 4.8 s, the statuses shown `["Active"]`.

## Steps to Reproduce

1. On a fresh emulator open `/aws/dynamodb/tables/create`, give a name and a partition key, press "Create table".
2. The table's page shows "Loading table" for about 3 s, then the table as "Active".

## Expected

- From "Create table"'s success until the first read answers, the table's page shows the table's name, keys and
  capacity mode as `CreateTable` answered them and the status "Creating", then what the read answers.
- A page opened by its address (no `CreateTable` answer at hand) behaves as now.

## Out of scope

The emulator's hold itself (upstream behavior). The table list's rows.
