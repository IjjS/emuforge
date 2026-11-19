Issue-Id: 517
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|emulator|probe-every-service-for-support
Issue-Check-Ids:
Issue-Commit: 6ea093492ca3f4ffe383389c807ad6ed9adb06d0

# Probe the emulator once for every one of the 224 services: which answer, which answer 501

> Identified against commit `6ea093492ca3f4ffe383389c807ad6ed9adb06d0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The target of Studio's AWS area is every service with a capture under `docs/aws-console/` (224, issues 69 to 292), and a
service's scope is what the emulator's API supports. Which of the 224 the emulator supports, and how far, is not known:
the board `.pm/product/services.md` holds "not probed" for all but five, so the order of the services rests on a guess.
The emulator is one binary with no listing of its services.

Wanted: a script of the harness, `.pm/bin/pm-probe-services`, that the `pm` runs by hand against an emulator of its own
(started and removed as a check's emulator is, never the owner's; credentials through `pm-emulator-dir`; `ca.pem`
verified; loopback only). For each service of a table it holds (the service's key as on the board, its signing name and
protocol, and its read operations that need no argument, such as a `List*` or `Describe*`), it sends those read calls
and writes, per service: answered (with the operations that answered), not implemented (501 or the emulator's own
refusal of the service), or failed (what was answered). It writes nothing to the emulator and sends nothing anywhere
else. The result is one file under `.pm/run/` that names the emulator's version, which the `pm` copies into the board.
A service with no read call that needs no argument is said so and left to its plan. The table of operations may be
built from the AWS CLI's service models when they are on the machine without any call to AWS; where it comes from
is said in the plan.

## Evidence

`.pm/product/services.md`, column `Emulator`.

## Steps to Reproduce

Read the board's `Emulator` column.

## Expected

After one run, the board says for each of the 224 services whether the emulator answers it.

## Out of scope
