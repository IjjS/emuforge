Issue-Id: 23
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: worker
Issue-Key: engine|relay.s3-signed-chunk-above-cap|intermittent-broken-pipe
Issue-Check-Ids:
Issue-Commit: 9da3e2fed389e98d3065f074872206c035ced109

# Make the over-cap signed chunk refusal reach the client every time

> Identified against commit `9da3e2fed389e98d3065f074872206c035ced109`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration check `engine.relay-s3-signed-chunk-above-cap-refused` fails some of the time on a tree whose engine
code has not changed. It sends a `PutObject` through the engine with one signed data chunk of 1048577 bytes, one
byte over the engine's cap on a chunk's data (1048576). Sometimes the client reads no answer at all: its write fails
with `Broken pipe (os error 32)` before it reads the engine's refusal. The other runs pass. So a client that sends an
over-cap chunk does not always get the engine's refusal, and the full check suite fails at random on this check.

## Evidence

- `pm-check` on `feat/19-s1` at `5b98463` passed, this check included. At `9da3e2f`, whose only change is one header
  line of an issue file, the first run failed on this check alone and the next run on the same commit passed.
- The failing run's report: `output/logs/check-integration-9da3e2f-run1.log` in the `feat/19-s1` worktree (ignored,
  not committed). The lines it printed:

  ```
  test relay_s3_signed_chunk_above_cap_refused ... FAILED
  assertion failed at tests/relay_signed_chunks.rs:42:29: PutObject with one signed data chunk of 1048577 bytes: the engine gave no answer: Broken pipe (os error 32)
  test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.59s
  ```

## Steps to Reproduce

1. Start a fresh emulator and the engine as `pm-check` does for the worktree.
2. Run `tests/integration/engine/tests/relay_signed_chunks.rs`, test `relay_s3_signed_chunk_above_cap_refused`,
   several times in a row.
3. Some runs fail with `the engine gave no answer: Broken pipe (os error 32)`.

## Expected

- A `PutObject` with one signed data chunk over the cap gets the engine's refusal, the status and body the check
  names, on every run.
- `engine.relay-s3-signed-chunk-above-cap-refused` passes on every run of an unchanged tree.

## Out of scope

- The cap's value and the refusal's status and body: only whether the refusal reaches the client.
- The other checks of `relay_signed_chunks.rs`, which passed on every run seen.
