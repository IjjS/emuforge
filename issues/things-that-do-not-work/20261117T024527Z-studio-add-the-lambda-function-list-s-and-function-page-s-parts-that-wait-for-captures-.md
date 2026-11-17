Issue-Id: 356
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.function-list|actions-attributes-popover-page-header
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Add the Lambda function list's and function page's parts that wait for captures: "Actions" entries, filtering by attribute, the "Last modified" popover, a function's header actions

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's Event Functions page has parts Studio's function list (issue 84) leaves out because nothing shows them open or names their entries: the further entries of "Actions" (Studio has "Delete" only), the attributes the filter "Search by attributes or search by keyword" offers (Studio filters by the start of the name only), and the popover that "Last modified" opens (Studio shows the time as text). A function's page has only "Refresh" in its header, so a function cannot be deleted from its own page, and the order of its tabs is taken from the user guide. The owner's capture `docs/aws-console/lambda/03-event-functions` shows the list with the menu closed and the filter empty, and no capture shows a function's page.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda list-functions   -> takes Marker, MaxItems, FunctionVersion and MasterRegion: no filter and no sort parameter; an item carries no State
$ aws lambda delete-function --function-name <name>   -> ok (what an entry "Delete" on a function's page would send)
The capture's outline of the Event Functions page: button "Actions" (a menu, closed, disabled), combobox "Search by attributes or search by keyword", column "Last modified" whose cell is a button ("7 days ago"), dialog "Delete functions".
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and select the function.
3. "Actions" offers one entry; the filter offers no attribute; "Last modified" is text; the function's page has no "Actions".

## Expected
- Once the owner has added captures of the Event Functions page with the "Actions" menu open, the filter's attributes shown and the "Last modified" popover open, and of a function's page with its header actions, the entries the captures show exist, each sending its operation and showing the emulator's answer; the labels and the order of the tabs are the captures'.
- Filtering by an attribute narrows the list within the rule against loading every page; an attribute the emulator cannot be asked for is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Sorting the list. Any engine change. Anything sent to real AWS.
