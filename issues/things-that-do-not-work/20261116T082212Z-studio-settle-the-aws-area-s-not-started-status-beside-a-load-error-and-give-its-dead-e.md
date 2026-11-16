Issue-Id: 51
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|aws-area|not-started-status-and-way-back
Issue-Check-Ids:
Issue-Commit: ab477dcb82b4712cca3f4fb48877609dd413c422

# Settle the AWS area's not-started status beside a load error and give its dead-end pages a way back into the area

> Identified against commit `ab477dcb82b4712cca3f4fb48877609dd413c422`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Two findings of the `final` critique of issue #45 (both P2, neither held the screens back; each needs a change
of that issue's requirement, so neither was a worker's fix):

- The emulator line shows "Not started on port <n>" with Cloudscape's grey `stopped` status (requirement R4.2
  of issue #45). On a service screen the same moment is a failed load, shown as an error. The line and the page
  would then tell two stories about one fact.
- "No screen yet" and "Page not found" inside the AWS area offer one button, "Go to Home", which leaves the
  area (requirement R6.2 of issue #45). A user who mistyped a path or opened a service without a screen wants
  the area's index first.

Order: the first point should be decided before or with the first AWS service screen.

Reference: none; EmuForge's own pages and states in the AWS area (`studio/AGENTS.md`, AWS screen policy).

## Evidence

`review-final.md` of issue #45, on the built app at `9e919c5`:
`studio/src/providers/aws/area/components/emulator-line.tsx:44` (the status type) and
`studio/src/providers/aws/area/components/empty-page.tsx:28-30` (the one button). Captures kept in the main
checkout at `output/captures/45-final-stopped/` (local).

## Steps to Reproduce

1. Open `/aws/s3` with the engine running and the emulator stopped: the line's status is grey.
2. Open `/aws/does-not-exist`: the only action is "Go to Home".

## Expected

- One decision, written into `studio/AGENTS.md`, on how the line's status and a screen's own load error relate
  when the emulator is not started, not answering or unreachable, and the line and the screens follow it.
- "No screen yet" and "Page not found" in the area lead to the area's index as their first action and to Home
  as the second.
- Flow checks cover both; the pages keep their critique pass.

## Out of scope

- Any service screen.
