Issue-Id: 513
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|dynamodb.items|critique-item-naming-and-editor
Issue-Check-Ids:
Issue-Commit: 041c721196b7be93e005837f6a10ba3b9ba9a8bc

# Name a DynamoDB item by its whole key in the items table, its deletion and its editor, and ask before discarding an edited item

> Identified against commit `041c721196b7be93e005837f6a10ba3b9ba9a8bc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The impeccable critique of issue 496's built screens (point `final`, rounds 1 and 2) left these P2 findings on the
"Items" tab and the item editor of `/aws/dynamodb/tables/table/<name>`; none is fixed in issue 496, whose confirmed
criteria fix the button texts:

- A row of a table with a composite key is named by its partition key alone: only the first key column sticks, the
  key buttons of rows that share a partition key share a name, and the selection checkboxes are labelled with raw
  key JSON.
- Deleting items does not name what it acts on: the button reads "Delete", and the dialog and the selection do not
  show the keys of the items.
- The items counter "(25)" counts the shown page and reads as the table's size, which the emulator cannot report.
- The editor's header names neither the item nor the table; Esc, the X or "Cancel" discards an edited text without
  asking (the "Create table" page asks); first focus is on Close, not the text; the text is in a proportional face.

## Evidence

`.pm/issue-496/review-final.md` (round 2, 27/40; items-tab.tsx:310-328, :347, :356, :367; item-editor.tsx:113-117,
:123, :141-149), its snapshot under `emuforge-496/studio/.impeccable/critique/`, and round 1's findings "item
deletion names what it acts on" and "the editor names item and table" (26/40). Captures:
`emuforge-496/output/captures/final2-seeded/`.

## Steps to Reproduce

1. Create a table with partition key `customerId` and sort key `orderId`, and three items of one customer.
2. Open its page, "Items": the three key buttons of the first column share one name; select two and press "Delete".
3. Open an item, change its text, press Esc: the change is gone without a question.

## Expected

- Every key column sticks; a row's key button and its checkbox are named by the whole key in words.
- The deletion's button, dialog and result name the items by their keys (or their number when many).
- The counter reads as a page's count while a `LastEvaluatedKey` says more remain (as the table list's "25+").
- The editor's header names the item's key and the table; a changed text is discarded only after the area's discard
  dialog; first focus is in the text; the face of the text is fixed-width by a route Cloudscape supports, or the
  choice is recorded.

## Out of scope

The P3 findings of the same critique (base64 hint for a Binary key, wrapping of map and list values).
