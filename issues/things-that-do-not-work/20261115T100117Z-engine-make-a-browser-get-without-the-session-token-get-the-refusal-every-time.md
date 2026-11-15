Issue-Id: 24
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: worker
Issue-Key: engine|studio-relay.browser-get-without-session|intermittent-200
Issue-Check-Ids:
Issue-Commit: d701a2693f9f824caa4492a520ac05733520459e

# Make a browser GET without the session token get the refusal every time

> Identified against commit `d701a2693f9f824caa4492a520ac05733520459e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration check `engine.studio-browser-reads-relayed-s3-answer`
(`tests/integration/studio/studio-relay.spec.ts`) failed once on a tree whose engine code and checks had not
changed. In a Chromium page at Studio's origin it puts an object, reads it back with the session token, then sends
the same `GET` of the same key without `X-EmuForge-Session` and expects a readable `401` whose body contains
`SessionRequired`. In the failing run that `GET` resolved with status 200 and the object's body `hello world`. The
other runs of the same branch passed. So a browser request without the session token does not always get the
engine's refusal.

## Evidence

- `pm-check` on `feat/19-s1` at `d701a26` (its last commits change issue files only) failed on this check alone:
  `output/logs/check-integration-d701a26-run1.log` in that worktree (ignored, not committed). The line it printed:

  ```
  failed  engine.studio-browser-reads-relayed-s3-answer  Error: GET /efit-1794736506-51293-sbr/k without X-EmuForge-Session: status, body hello world
  ```

- Four earlier full runs on the same branch (`5b98463`, `9da3e2f` twice, `0590dcc`) passed this check.
- In the same failing run the engine's own check `studio_relay_refuses_without_current_session`
  (`tests/integration/engine/tests/studio_relay.rs`), which sends its requests without a browser, passed.
- The failing `GET` repeats a URL the browser had just fetched with the token, and it got that `GET`'s status and
  body, so an answer from the browser's HTTP cache is not ruled out. If that is so, a relayed answer that needed
  the session can be served by the browser without it: the relayed answer's caching headers are the first thing to
  look at.

## Steps to Reproduce

1. Start a fresh emulator, the engine and Studio's built app as `pm-check` does for a worktree.
2. Run `engine.studio-browser-reads-relayed-s3-answer` several times in a row.
3. Some runs fail at the `GET` without `X-EmuForge-Session`, with status 200 and the object's body.

## Expected

- A browser `GET` of a relayed S3 object without `X-EmuForge-Session`, sent right after the same `GET` with the
  token, resolves with status 401 and a body that contains `SessionRequired`, on every run.
- `engine.studio-browser-reads-relayed-s3-answer` passes on every run of an unchanged tree.

## Out of scope

- The refusal's status and body themselves, which the check already names.
- Requests sent without a browser, which `studio_relay_refuses_without_current_session` covers and which passed.
