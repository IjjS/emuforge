Issue-Id: 46
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|structure-score|parts-not-in-the-emulator
Issue-Check-Ids: harness.spec harness.score harness.records harness.docs
Issue-Commit: f91e23282a1e0377835ed9b76e716013d162b259

# Let a reference spec mark a console part as not in the emulator so the structure score leaves it out

> Identified against commit `f91e23282a1e0377835ed9b76e716013d162b259`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A `console` screen passes when its structure score is 90 or more, and the score counts every item of its
reference spec, which lists what is on the AWS console's screen. Under the AWS screen policy (issue #45, point
4) a part the emulator does not have (a panel, a tab, a navigation entry, a badge) is left off the screen on
purpose. Such a part is then an unmatched item and the screen cannot reach 90: the S3 bucket list sample that
the owner chose leaves out 24 of the console's 55 items.

A reference spec needs a way to record that a console part exists and is left out because the emulator does
not have it, and the score has to leave that part out instead of counting it against the screen.

Order: with issue #45, before the first AWS service screen.

Reference: the method in `studio/references/console-reference.md`.

## Evidence

- `studio/references/critique.md`: "structure score is 90 or more, and no unmatched item is the title, the
  primary action or a table column".
- `.initial-refs/policy/aws-screen-sample-review-r2.md` (main checkout, outside git), Counts: sample B is the
  same as the console in 26 of 55 items and different in 24, all of them parts the emulator lacks.
- `.pm/bin/_pmspec.py` has no field by which an item is marked as absent from the emulator.

## Steps to Reproduce

1. Write a spec that lists the console's "Account snapshot" panel for the S3 bucket list.
2. Score a screen that correctly leaves the panel out: the item is unmatched and lowers the score.

## Expected

- A spec item can be marked as not in the emulator, with a reason. A marked item is not scored, is reported as
  left out on purpose, and fails the run if the screen shows it anyway.
- The title, the primary action and a table column cannot be marked.
- An action on a resource the emulator has is not such a part (issue #45's open point on 501 decides it).
- The score, the report and the recorded row say how many items were left out, so a screen cannot pass by
  marking most of its spec.
- `console-reference.md` and `critique.md` describe the mark and who may set it (the spec's author at the
  Screen stage, reviewed by `rev`, with evidence that the emulator lacks the part).

## Out of scope

- The policy's wording and Studio's guides: issue #45.
