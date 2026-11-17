Issue-Id: 439
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|aws-area.connection-status|duplicated-mapping
Issue-Check-Ids:
Issue-Commit: c908662212b590c99d13cce0d0fb8e9fc1f33cb7

# Give the emulator line's status words one source the area's screens share

> Identified against commit `c908662212b590c99d13cce0d0fb8e9fc1f33cb7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The emulator line words each connection state in one mapping, `lineStatus` in
`studio/src/providers/aws/area/components/emulator-line.tsx`, which is not exported. The S3 bucket list's
"not connected" state must repeat the line's status in the same words and with the same Cloudscape status type
(`studio/AGENTS.md`, "The emulator line"; requirement R7 of issue 56), so its page holds a second copy of the
mapping, `connectionStatus` in `studio/src/providers/aws/area/services/s3/pages/bucket-list-page.tsx` (decision
13 of issue 56, option a, recorded as temporary). Two copies can drift: a change of wording in the line would
leave the screen saying something else for the same state. Every later service screen with a "not connected"
state would add another copy.

## Evidence
- `studio/src/providers/aws/area/components/emulator-line.tsx:50`: `function lineStatus(...)`, module-private.
- `studio/src/providers/aws/area/services/s3/pages/bucket-list-page.tsx:72`: `function connectionStatus(...)`,
  the same words and status types for "Not started on port", "Not answering at", "The EmuForge engine at … is not
  answering" and the two "The EmuForge engine answered …" states.
- `.pm/issue-56/decisions-needed.md` question 13 and `review-impl-s3-r1.md` (P1) of issue 56.

## Steps to Reproduce
1. Search `studio/src/providers/aws/area/` for "Not started on port ".
2. The text is found in two mappings, one in `components/emulator-line.tsx` and one in
   `services/s3/pages/bucket-list-page.tsx`.

## Expected
- One exported mapping from a connection to its status (words and Cloudscape status type) is used by the emulator
  line and by the bucket list's "not connected" state; neither file holds its own copy.
- The emulator line and the bucket list show the same words and status type for every non-connected state, as
  their unit cases already assert.

## Out of scope
- The wording of any status.
- Which states a screen shows as "not connected".
