Issue-Id: 486
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|targets|emulator-connections-screens
Issue-Check-Ids: 486
Issue-Commit: aa4c03efad86f9b110d88c61c26e552f651ddd90

# Let Studio register, choose, test and remove emulator connections and switch the target its screens read

> Identified against commit `aa4c03efad86f9b110d88c61c26e552f651ddd90`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's product plan of 2026-11-18 (BRD), kept verbatim in Korean at `.pm/product/brd-2026-11-18.md` in the main checkout (untracked; issue 483 brings it into the repository). Its section 4: Emulator Connections (register, choose, remove several emulators), Target Switching (the
chosen emulator is what the screens read), Connection Status (connected or not, the error, the endpoint). Today Home
shows the one emulator's status and the AWS area's emulator line names it. On the engine's API of issue 485.

## Evidence

The plan's file; `studio/src/features/home/`, the area's emulator line.

## Steps to Reproduce

Studio has no way to add or switch an emulator.

## Expected

In Studio a developer adds an emulator by its endpoint, tests it, makes it the target, and every AWS screen then reads it; the status says which target and whether it answers.

## Out of scope
