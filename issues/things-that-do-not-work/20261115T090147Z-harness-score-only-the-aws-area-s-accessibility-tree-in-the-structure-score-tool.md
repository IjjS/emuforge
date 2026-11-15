Issue-Id: 21
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: gap
Issue-Source: plan
Issue-Key: harness|structure-score|aws-area-scope
Issue-Check-Ids:
Issue-Commit: ec897b9b1f81d6b3ef567cbe08bdc83e94bfdfb0

# Score only the AWS area's accessibility tree in the structure score tool

> Identified against commit `ec897b9b1f81d6b3ef567cbe08bdc83e94bfdfb0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/references/console-reference.md`, "Structure score" step 1 (amended by commit `42aa007`), scores the
accessibility tree of the AWS area only: everything under the area's root, its `AppLayout` with the breadcrumbs
included; Studio's frame around the area is not part of the screen and is not scored. `pm-structure` still takes
and scores the whole page's tree, so a node of Studio's frame (its top bar) can match a spec item, and an
unmatched item can be hidden by a frame node with the same role and name. The reference is the method in
`console-reference.md`.

## Evidence

- `console-reference.md:75-78`: "take the accessibility tree (roles and accessible names) of the AWS area:
  everything under the area's root ... Studio's frame around the area is not part of the screen and is not scored."
- `.pm/bin/_pmstructure_capture.mjs:109`: the snapshot is `Accessibility.getFullAXTree` of the whole page, flattened
  without any scoping; `.pm/bin/_pmscore.py` (`score`) matches items against every node of that snapshot.
- `git log -- .pm/bin/_pmstructure_capture.mjs .pm/bin/_pmscore.py` has no commit after `42aa007` that scopes the tree.
- The area's root is a plain `div` with a class (`studio/src/providers/aws/area/area-layout.tsx:85`), which has no
  role or name in the accessibility tree, so the scoping cannot be done from the snapshot alone today.

## Steps to Reproduce

1. Build Studio and write a spec whose `header.title` equals a heading or button name in Studio's frame and
   that the AWS area screen does not show.
2. Run `pm-structure <worktree> <spec> --serve <built app>`: the item is reported `matched` by the frame's node.

## Expected

- A node outside the AWS area's root never matches a spec item and is never listed as an extra.
- The snapshot the tool writes holds only the AWS area's subtree, or marks which nodes are inside it, so a
  `--snapshot` re-score gives the same result.
- A page without the AWS area's root is an `error`, not a score.

## Out of scope

- Wizard and dashboard specs (issue #8).
- Changing Studio's frame or the AWS area's markup beyond what the scoping needs.
