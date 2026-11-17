Issue-Id: 340
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dynamodb.table-list|menus-tag-filter-favorite
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Add the DynamoDB table list's and table page's parts that wait for captures: "Actions" entries, the second menu, "Filter by tag", "Favorite"

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's Tables page has parts Studio's table list (issue 72) leaves out because nothing shows them open or names their entries: the further entries of "Actions" (Studio has "Update to on-demand capacity mode" only), the unnamed menu button beside "Create table", the selects "Filter by tag" and "Filter by tag value", and the column "Favorite". A table's page has no "Actions" menu at all, so a table cannot be deleted or updated to on-demand from its own page. The owner's capture `docs/aws-console/dynamodbv2/03-tables` shows the list empty with both menus closed, and no capture shows a table's page.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dynamodb list-tags-of-resource --resource-arn <table>   -> 200, the table's tags (so a tag filter has something to read)
$ aws dynamodb list-tables   -> takes no tag and no filter parameter
All 57 operations of `aws dynamodb` called: none stores or returns a favorite.
The capture's outline of the Tables page: button "Actions" (closed, disabled), a button without a name beside the link "Create table", comboboxes "Filter by tag" and "Filter by tag value", column heading "Favorite".
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table with a tag with the AWS CLI.
2. Open `/aws/dynamodb/tables` and select the table.
3. "Actions" offers one entry; there is no tag filter and no column "Favorite"; the table's page has no "Actions".

## Expected
- Once the owner has added captures of the Tables page with rows and both menus open, and of a table's page with its menu open, the entries the captures show exist, each sending its operation and showing the emulator's answer; the labels are the captures'.
- "Filter by tag" narrows the list by asking the emulator for tags, within the rule against loading every page.
- "Favorite" is decided with the `pm`: Studio stores nothing but its language today.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Sorting the list. Any engine change. Anything sent to real AWS.
