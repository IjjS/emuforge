Issue-Id: 22
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: worker
Issue-Key: engine|relay-s3-signed-chunk-above-cap-refused|intermittent-broken-pipe
Issue-Check-Ids: engine.relay-s3-signed-chunk-above-cap-ends-cleanly engine.relay-early-answer-matches-direct engine.relay-s3-signed-chunk-above-cap-refused
Issue-Commit: 4b9442c73158bd0bfd8046fd978f19c226b6acaf

# Answer a signed chunk above the cap without an intermittent broken pipe

> Identified against commit `4b9442c73158bd0bfd8046fd978f19c226b6acaf`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The integration check `engine.relay-s3-signed-chunk-above-cap-refused` failed once and passed on the next run of
the same commit, with nothing changed in the engine or the check. In the failing run the client got no HTTP
answer from the engine for a PutObject whose single signed data chunk is 1048577 bytes (one byte above the cap):
writing the request body ended with `Broken pipe (os error 32)`. The check expects the engine to answer that
request with its refusal. An intermittent outcome of a confirmed check makes `pm-check` red for a reason unrelated
to the unit under test. Whether the engine closes the connection before the refusal reaches the client, or the
check's client stops reading the answer after the write fails, is the fixer's to trace.

## Evidence
- Found by worker `i12-worker-t1` (issue 12, a harness-only unit that touches no engine or check file) in the full
  `pm-check` of `feat/12-t1` at commit `4b9442c73158bd0bfd8046fd978f19c226b6acaf`, on a loaded machine (memory
  17-18 GB used, swap 6.3/7.0 GB; another worktree's Playwright run active).
- Run 1, `integration` failed: `tests/relay_signed_chunks.rs:42:29: PutObject with one signed data chunk of
  1048577 bytes: the engine gave no answer: Broken pipe (os error 32)`; the other 6 tests of
  `relay_signed_chunks` passed. Log: `emuforge-12-t1/output/logs/t1-check-integration-run1.log` (lines 140-162).
- Run 2, `pm-check --only integration` on the same commit, minutes later: `integration passed` (171.2 s). Log:
  `emuforge-12-t1/output/logs/t1-pm-check-integration-run2.log`.

## Steps to Reproduce
1. On a checkout at the commit above, with a fresh emulator on the worktree's `emulator` port, run
   `.pm/bin/pm-check <worktree> --only integration` several times, preferably while the machine is busy.
2. Look for `failed  engine.relay-s3-signed-chunk-above-cap-refused` with `Broken pipe` in
   `output/logs/check-integration.log`.

## Expected
- `engine.relay-s3-signed-chunk-above-cap-refused` passes on every run of an unchanged commit: the client always
  receives the engine's refusal of a signed data chunk above 1048576 bytes, and never a broken pipe without an
  answer.

## Out of scope
- The chunk cap's value and the refusal's content, which the check already fixes.
- The other `engine.relay-s3-signed-chunk-*` checks, which passed in both runs.
