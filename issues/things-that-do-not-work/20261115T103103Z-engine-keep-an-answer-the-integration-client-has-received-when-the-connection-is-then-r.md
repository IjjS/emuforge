Issue-Id: 27
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|integration-aws-client|answer-lost-after-reset
Issue-Check-Ids:
Issue-Commit: 37f568848d80f32259e69837fae525c1ce89940c

# Keep an answer the integration client has received when the connection is then reset

> Identified against commit `37f568848d80f32259e69837fae525c1ce89940c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The HTTP client of the engine integration checks (`tests/integration/engine/support/aws.rs`, `Call::send` ->
`exchange` -> `read_response` -> `read_more`) can lose an answer it has already received. `read_more` sets the read
timeout with `set_read_timeout` (`setsockopt(SO_RCVTIMEO)`) before every read and returns that call's error. On
macOS, `setsockopt` on a socket whose peer has reset the connection fails with `EINVAL`, even though `recv` would
still return the bytes that arrived before the reset. After a failed body write, `exchange` also replaces the read's
error with the write's error (`map_err(|_| e)`). So the check reports "the engine gave no answer: Broken pipe"
while the answer is sitting in the socket, and the real cause is hidden. The reference is a client that reads the
socket until its end: it returns the answer and then reports the reset.

The engine side of the same exchange (it resets the connection after an early answer) is issue #22. Once #22 is
fixed the engine no longer resets within its drain bound, so no confirmed check fails because of this today. It
remains for any exchange that ends in a reset, and for the misleading message.

## Evidence
- Found while planning issue #22, on `main` 73827dd, Darwin 25.6.0. Evidence in `.pm/issue-22/evidence/`
  (`versions.txt`; summarised in `.pm/issue-22/requirement.md` §1b).
- `python3 -I .pm/issue-22/evidence/einval.py` -> `Darwin 25.6.0: setsockopt(SO_RCVTIMEO) after the reset -> OSError
  errno 22 (Invalid argument); recv -> b'hello'` (`logs/einval.txt`).
- `repro.py <engine port> 300 std` (the client's socket calls, against the engine on `main`): in 68 of 300 runs
  `setsockopt` failed with `EINVAL` before any byte was read, and in all 68 a plain `recv` then returned the full
  333-byte `400 ChunkTooLarge` answer (`logs/std-alone.jsonl`).
- `engine.relay-s3-signed-chunk-above-cap-refused`, 300 runs on `main`: 113 failed with `Broken pipe`, `Connection
  reset by peer` (the masked write error) or `Invalid argument` (`logs/alone.txt`).

## Steps to Reproduce
1. On `main` before #22's fix, start a fresh emulator on a free port and the engine on another.
2. `python3 -I .pm/issue-22/evidence/repro.py <engine port> 300 std`, and look for rows with
   `"read_end": "setsockopt:EINVAL"` and `"left_bytes": 333`.
3. Or run `engine.relay-s3-signed-chunk-above-cap-refused` repeatedly (`.pm/issue-22/evidence/loop.sh`) and read
   the failed runs' logs: `no answer: Broken pipe (os error 32)`.

## Expected
- When the peer sends a complete answer and then resets the connection, the client returns that answer.
- When no complete answer arrives, the error the client reports names the read's own failure (for example the
  reset), not only the write error that came before it.

## Out of scope
- The engine's reset after an early answer (issue #22).
- The bounds `IDLE_BOUND` and `EXCHANGE_BOUND`.
