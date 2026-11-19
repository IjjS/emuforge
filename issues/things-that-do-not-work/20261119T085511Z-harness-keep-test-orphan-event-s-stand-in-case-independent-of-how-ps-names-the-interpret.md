Issue-Id: 511
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|test_orphan_event|process-name-python-or-python3-14
Issue-Check-Ids:
Issue-Commit: b8918ca052eeed0774128167bcbc154fe4a0efa9

# Keep test_orphan_event's stand-in case independent of how ps names the interpreter

> Identified against commit `b8918ca052eeed0774128167bcbc154fe4a0efa9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In issue 494's whole check (2026-11-19 17:52, the machine under three whole checks at once) the harness tests failed
once and passed on the second run. The one failure: `test_orphan_event.Tick.test_a_running_check_s_stand_in_is_not_told_and_an_orphan_beside_it_is`
expected the event's names as `Python×2,python3.14×1` and got `Python×3`: the stand-in the case starts as
`python3.14` was listed by `ps` under the name `Python` at that look. The case pins how the system names a process
that it does not control.

Wanted: the case tells its stand-ins apart by something it controls (their pids, or a name it sets), so the names
`ps` gives do not decide it.

## Evidence

`.pm/archive/critique-snapshots/flakes/494-harness-test.attempt1.log` (first run); `.pm/run/flakes.jsonl`.

## Steps to Reproduce

Run the harness tests while the machine is loaded; intermittent.

## Expected

The case passes whatever `ps` names the interpreter.

## Out of scope
