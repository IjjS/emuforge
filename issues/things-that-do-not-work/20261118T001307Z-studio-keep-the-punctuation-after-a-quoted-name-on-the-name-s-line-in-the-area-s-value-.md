Issue-Id: 474
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|aws-area|value-element-leaves-punctuation-alone-beside-a-quoted-name
Issue-Check-Ids:
Issue-Commit: 3e36c96a2db31f77f893d9518d270975129c5fd1

# Keep the punctuation after a quoted name on the name's line in the area's value element

> Identified against commit `3e36c96a2db31f77f893d9518d270975129c5fd1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The final critique of issue 467 (2026-11-18) lists one new P2 under rule 4 of `studio/AGENTS.md`, "What every
AWS screen does": where a sentence quotes a name with the area's value element
(`studio/src/providers/aws/area/components/value-text.tsx`), the punctuation that follows the name (the closing
quotation mark, a full stop) can be left alone at the start of the next line, because the name is its own box and
the line may break after it. The critic saw it on S3's sentences that quote a bucket's name; the element is the
area's, so Lambda's and IAM's sentences that quote a name can show it too. It is not one of the five findings of
issue 467 and was not corrected there.

## Evidence

`.pm/archive/critique-snapshots/467-review-final.md`, the P2 under rule 4 and the acceptance note at line 84;
the captures it names were under `emuforge-467/output/captures/final-s3/` (removed with the worktree; the critique
snapshot names the screen and the sentence).

## Steps to Reproduce

Open S3's delete or empty dialog of a bucket with a long name at 390 wide and read the sentence that quotes the
name: the mark or the full stop after the name begins a line.

## Expected

The punctuation directly after a quoted name stays on the line the name ends on, on every screen that uses the
area's value element, without restyling Cloudscape's components.

## Out of scope
