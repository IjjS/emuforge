Issue-Id: 665
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|sqs|redrive-move-task-not-listed-on-emulator-1.0.633
Issue-Check-Ids: studio.sqs-redrive-dead-letters-back-to-their-source
Issue-Commit: 3ca5e3bfd5c5e191ea695f3f4c8eb2d53d0a6517

# Make the SQS redrive check pass on emulator 1.0.633 where the move task is not listed

> Identified against commit `3ca5e3bfd5c5e191ea695f3f4c8eb2d53d0a6517`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The machine's emulator image moved from 1.0.625 to 1.0.633 on 2026-11-27, and the full checks of `main` at
`3ca5e3bfd` then failed in one integration check, `studio.sqs-redrive-dead-letters-back-to-their-source`. After
"Redrive" with "Back to their source queues" and "Start", the check waits 20 seconds for the dead-letter queue's
move tasks to show one row `COMPLETED`, "Source queues", "1 of 1"; the list of move tasks stayed empty. Every other
step and check passed. The same check passed on 1.0.625 (the run on GitHub Actions of `3ca5e3bf`, 45889436187, and
the full checks of `main` on 2026-11-26).

It was run once and is not known to be the emulator's change or a failure that comes and goes: find out first
which. The emulator may no longer list a finished move task (`ListMessageMoveTasks`), may list it later, or the
move itself may not have started; the check's Given or the screen's read may need to follow what the emulator now
answers.

## Evidence

- `.pm/run/main-check-1.0.633.log`: `failed checks (1): studio.sqs-redrive-dead-letters-back-to-their-source`,
  `emulator 1.0.633`, `NOT PASSED commit=3ca5e3bfd scope=main failed=['integration']`.
- `.pm/run/main-check-1.0.633-sqs-redrive.log` (the check's own log): "1 of 2 criteria lines failed", `the move
  tasks`, expected `[["COMPLETED", "Source queues", "1 of 1"]]`, received `[]`, "Timeout 20000ms exceeded while
  waiting on the predicate".
- `.pm/run/main-check-1.0.633-integration.log`: the integration step's log.

## Steps to Reproduce

1. With the machine's image `aws-emulator` at 1.0.633, on `main`: `pm-check . --checks
   studio.sqs-redrive-dead-letters-back-to-their-source`.
2. Against an emulator of that image, send `StartMessageMoveTask` for a dead-letter queue holding one message and
   read `ListMessageMoveTasks` for it, and compare with what 1.0.625 answered.

## Expected

- It is stated, from calls to the emulator, what 1.0.633 answers for a started and a finished move task.
- `studio.sqs-redrive-dead-letters-back-to-their-source` passes on 1.0.633, and the screen shows a redrive's
  outcome as far as the emulator reports it.
- If the emulator no longer reports what the criteria line asks, the line is changed on the `pm`'s decision, with
  the reason recorded.

## Out of scope

Any other SQS screen. Anything sent to real AWS.
