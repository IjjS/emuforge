Issue-Id: 510
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|pm-watchd|unregistered-told-for-a-pane-just-closed
Issue-Check-Ids: harness.registry
Issue-Commit: 807e51faa43f4c53aa05c3c2ee9788aefabb4faf

# Do not tell EVENT unregistered for a pane pm-pane has just closed

> Identified against commit `807e51faa43f4c53aa05c3c2ee9788aefabb4faf`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

At 17:54:30 on 2026-11-19 `i494-plan` closed its worker (`pane close i494-worker-s1 wQ:pFN` in `events.log`), and one
second later `pm-watchd` told the `pm` `EVENT unregistered i494-worker-s1 wQ:pFN`. The pane was not lost: the close
takes it out of the registry before herdr has let the agent go, and the look that the close's own wake starts still
finds the agent in herdr's list, with no `pm-pane` holding its pane-op file any more. The event of issue 504 then
names a pane that is going away, and the `pm` is told to adopt it.

Wanted: a pane that `pm-pane close` has just closed is never told as unregistered (for example the close holds its
pane-op until herdr no longer lists the agent, within a bound, or the daemon keeps the pane ids closed in the last
seconds and leaves them out); a harness test of a close whose agent stays in herdr's list for a moment.

## Evidence

`.pm/run/events.log`, 2026-11-19T17:54:30 and 17:54:31.

## Steps to Reproduce

`pm-pane close <pane>` while `pm-watchd` runs; read `events.log`.

## Expected

No `EVENT unregistered` for the closed pane.

## Out of scope
