Issue-Id: 464
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|s3-bucket-list|long-word
Issue-Check-Ids: studio.s3-values-break-where-they-can-be-read
Issue-Commit: 5ee0aa6a06a0762eabff61024e68bceeb35040fe

# Break a long bucket name inside its cell on the S3 bucket list

> Identified against commit `5ee0aa6a06a0762eabff61024e68bceeb35040fe`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On the S3 bucket list (issue 56, on `main`), with "Wrap lines" on as the list opens, a bucket name of 63
characters without a hyphen does not break inside its cell: it stays on one line, the name's column is 530 px
wide, and the table (822 px) scrolls sideways inside its wrapper (348 px at 390 wide). The page itself stays
within the viewport, which issue 56's requirement R12 allows ("a table may scroll inside itself"), so this is
the mild form of the fault issues 84 (Lambda) and 82 (IAM) corrected in their own lists, where the page scrolled.

Measured by issue 256's unit `s2` on 2026-11-17 (built app of `feat/256-s2` at `ad891af`, the list's files as on
`main`; aws-emulator on a port of its own; headless Chromium, light; 390 and 1280 wide).

## Evidence

`.pm/issue-256/decisions-needed.md` line 15; the script and its output were `output/logs/list-measure.log` of
worktree `emuforge-256-s2` (kept until issue 256 is archived).

## Steps to Reproduce

1. Make a bucket with a name of 63 characters without a hyphen; open `/aws/s3` at 390 wide.
2. The name is on one line and the table scrolls sideways inside itself.

## Expected

- With "Wrap lines" on, the name breaks inside its cell (the area's breaking element, as
  `services/s3/components/break-anywhere.tsx` of issue 256), with a unit case and a line of the list's layout
  check.

## Out of scope

- The Lambda and IAM lists (corrected in issues 84 and 82).
