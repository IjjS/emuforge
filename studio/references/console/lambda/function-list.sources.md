# Where each item of `function-list.yaml` is found

Source: the owner's capture of the English console, `docs/aws-console/lambda/03-event-functions.mhtml` (HTML part
0), read on 2026-11-17 as an outline of roles and accessible names with `probe/capture-outline.py`; nothing is
copied but the labels. User guide: AWS Lambda Developer Guide, English,
`docs.aws.amazon.com/lambda/latest/dg/<page>.html`, read the same day with `probe/guide-lines.py`: **Start** =
`getting-started`.

| Spec item | Source |
|---|---|
| `breadcrumbs` Lambda, Event Functions | capture: `nav` "Breadcrumbs" with the links "Lambda" and "Event Functions" (current) |
| `header.title` Event Functions, `counter` | capture: `h1` "Event Functions (4)" |
| `header.actions` Refresh | capture: `button` "Refresh" |
| `header.actions` Actions | capture: `button` "Actions" with a menu (closed, disabled with no row selected); Start: "Choose **Actions**, **Delete**" |
| `header.actions`, `primary_action` Create Event Function | capture: `link` "Create Event Function" after "Actions"; Start: "Choose **Create Event Function**" |
| the actions' order | capture: Refresh, Actions, Create Event Function, in that order |
| `table.selection` multi | capture: a check box "Select all items" in the heading row and one per row, named by the function |
| `table.filter` property | capture: `combobox` "Search by attributes or search by keyword" (a property filter's input, not a plain text input) |
| `table.pagination` | capture: `button` "Previous page", "Page 1 of all pages", "Next page" |
| `table.columns` and their order | capture: `columnheader` "Function name", "Description", "Package type", "Runtime", "Type", "Last modified" |
| `table.empty.title` No functions | **not the console's**: the capture's list has rows and shows no empty state; Studio's own first line (requirement R10.1; `decisions-needed.md`, question 5) |
| `table.empty.action` Create Event Function | the header's primary action, as Cloudscape's empty state repeats it; no source shows the console's empty list (question 5) |

Not items, and where the requirement uses them: the dialog "Delete functions" with the label `To confirm deletion,
type "confirm" in the field.`, the placeholder "confirm", "Cancel" and "Delete" (capture: `dialog` with `h2`
"Delete functions"; Start: "Type confirm in the text input field and choose **Delete**"); the cell values "Zip",
"Node.js 24.x", "Standard" (capture: the four rows); "Preferences" (capture: `button`).
