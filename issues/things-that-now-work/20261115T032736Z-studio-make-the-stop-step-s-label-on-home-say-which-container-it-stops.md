Issue-Id: 18
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|home.emulator-recovery-step-1|ambiguous-label
Issue-Check-Ids: studio.home-kill-notice-stop-step-names-container
Issue-Commit: 6d3a1703d66bd51d5643757d8e3f4eff6e8670f2

# Make the stop step's label on Home say which container it stops

> Identified against commit `6d3a1703d66bd51d5643757d8e3f4eff6e8670f2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

When Home shows an emulator recovery notice with a stop step (reasons `connection_refused`, `tls_untrusted`,
`files_unreadable`, `timeout`), step 1's label ends with "(a container started with the command below)". The
command directly below that label is the stop command (`docker rm -f emuforge-emulator-<port>`), not the start
command the parenthesis means; the start command is step 2, further down. A reader can take "the command below" to
be the stop command itself. Found by the critique of issue #16's alternative mock (`.pm/issue-16/review-candidate-alt.md`,
P3, last item), which keeps issue #3's wording unchanged as issue #16 requires.

## Evidence

- `studio/src/features/home/connection-alerts.tsx:114` builds the label
  `` `1. ${stopLabel} (a container started with the command below)` ``, and the `CommandBlock` rendered with it holds
  `stopEmulatorCommand(port)`.
- Capture `output/captures/alt-16/` page `home-emulator-killed` (issue #16 mock, same wording): step 1 "Stop what is left
  of the emulator (a container started with the command below)" directly above `docker rm -f emuforge-emulator-9297`.

## Steps to Reproduce

1. Start the engine and an emulator on a free port, open Studio's Home, wait for "Connected".
2. `docker rm -f emuforge-emulator-<port>` (kill without cleanup).
3. Within 10 seconds Home shows the error notice; read step 1's label and the command right under it.

## Expected

- Step 1's label names the container it stops without pointing at "the command below" (for example by referring to
  step 2's start command or to the container's name), in every notice that has a stop step.
- The commands, their order and their copy buttons are unchanged.

## Out of scope

- The other wording of the notices, the commands themselves, and issue #16's redesign of Home.
