Issue-Id: 571
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|integration-run|engine-port-not-free-for-the-next-check
Issue-Check-Ids:
Issue-Commit: f52fddc501b4726bf50ae4ec7f5ea046ee53b7b1

# The integration run starts a check while the engine port of the one before is still taken

> Identified against commit `f52fddc501b4726bf50ae4ec7f5ea046ee53b7b1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

In the same run the second run of `integration` ended with exit 127 on an error of the run itself, no check's
verdict: `studio.dynamodb-routes-lead-to-the-table-screens` (0.1 s) `EnvError: environment: 127.0.0.1:44799 is not
free: listen EADDRINUSE`. 44799 is the run's own engine port: the check before it
(`studio.dynamodb-tables-made-outside-are-listed`, 16.4 s) had just ended, and its engine had not let the port go
when the next check asked whether it was free. Every browser check starts its own engine on the run's one engine
port, so the hand-over between two checks is a race that a slower machine loses.

Wanted: a check starts only when the engine of the check before it has ended and the port is free (the run waits
for the process to exit and for the port, within a bound, before the next check; or a check's end waits for its
own engine's exit), so that the error cannot come from the run's own earlier check. No test is added (issue 523).

Filed from a run on GitHub Actions: it waits for the owner's signal.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44659707222 ; the failed steps' log `.pm/run/ci-70c1a2b.log` (the second run).

## Steps to Reproduce

Intermittent on GitHub Actions: two browser checks of one run, one after the other.

## Expected

No check fails for a port the run's own earlier check still holds.

## Out of scope
