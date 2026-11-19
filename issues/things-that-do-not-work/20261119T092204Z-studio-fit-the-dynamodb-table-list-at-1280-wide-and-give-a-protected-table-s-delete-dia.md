Issue-Id: 514
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|dynamodb.table-list|critique-width-and-protected-delete
Issue-Check-Ids:
Issue-Commit: 041c721196b7be93e005837f6a10ba3b9ba9a8bc

# Fit the DynamoDB table list at 1280 wide and give a protected table's delete dialog a way out

> Identified against commit `041c721196b7be93e005837f6a10ba3b9ba9a8bc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Two P2 findings of the impeccable critique of issue 496's built screens (point `final`, round 2), not fixed there:

- At a window 1280 wide the table list of `/aws/dynamodb` is 1035px in a 951px container: the header "Capacity mode"
  wraps, "On-demand" breaks inside the word, the last column is partly out of view, and Cloudscape's sticky
  scrollbar adds a tab stop without a name.
- The delete dialog of a table with deletion protection leads into a delete the emulator can only refuse
  (`ValidationException`), and names no way out.

## Evidence

`.pm/issue-496/review-final.md` (round 2; table-list-page.tsx:47, :299-309; delete-table-dialog.tsx:74-81);
captures `emuforge-496/output/captures/final2-seeded/`.

## Steps to Reproduce

1. Create a few tables, one with deletion protection, one provisioned.
2. Open `/aws/dynamodb` in a window 1280 wide: the list scrolls sideways.
3. Press "Delete" on the protected table and confirm: the emulator refuses.

## Expected

- At 1280 wide the seven columns fit their container with no sideways scroll and no word broken inside.
- The dialog of a protected table says how protection is turned off (with any tool pointed at the emulator, until
  issue 329 builds it in Studio); whether "Delete" stays enabled is decided and recorded.

## Out of scope

Changing deletion protection in Studio (issue 329). The critique's P3 findings (the confirm placeholder, the two
helper lines above the search).
