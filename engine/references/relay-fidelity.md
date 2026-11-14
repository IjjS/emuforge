# Relay fidelity

The engine's promise is that a caller cannot tell it is there, except where EmuForge says so. This file
defines that promise precisely enough to measure.

## Transparency

Send one request twice against the same emulator state: once straight to aws-emulator signed with the
emulator's key, once through the engine as an authorized caller. The two responses are **transparent** when
all of these are equal:

- the status code
- the body, byte for byte, after replacing values the emulator generates fresh per request (request ids,
  timestamps, generated resource ids) with placeholders
- `Content-Type`, and every `x-amz-*` response header except request ids
- for an error: the error code and message

These may differ and are ignored: `Date`, `Server`, connection and transfer headers, request id headers.

The engine may differ on purpose in exactly these cases, each with its own check:

| Case | What the caller sees instead |
|---|---|
| IAM enforce mode denies the request | An AWS-shaped `AccessDenied` in the caller's protocol, naming the statement or the missing allow |
| The caller is not identified | The error AWS returns for an unsigned or wrongly signed request |
| The emulator is unreachable | A 5xx in the caller's protocol saying the emulator is not running, with the endpoint |

Anything else that differs is a `gap` issue.

## What must pass through untouched

- A response of HTTP 501 `NotImplemented` from the emulator. The engine never turns it into success, a
  different error, or an empty result.
- The body in both directions, streamed. The engine does not parse, re-encode or re-chunk it.
- Operations AWS serves without a signature.

## Paired checks

A transparency check is an integration check that performs the pair above and asserts equality. One check
covers one operation in one protocol. Each has a row in `/tests/integration/manifest.jsonl` with the label
`transparency`.

Choose operations to cover each wire protocol and each body shape rather than each service: a JSON-protocol
call, a REST-XML call with a streamed upload, a Query-protocol call, a paginated list, a presigned URL, an
operation that returns 501.

## Score

```
relay fidelity = transparency checks passed / transparency checks total
```

- Reported per run with the emulator version and the commit, since both move.
- A check that fails on both sides in the same way (the emulator's own gap) counts as passed: the engine was
  transparent.
- The score on an issue branch is never lower than on `main` at the branch point. A lower score blocks the merge.
- The score says how much of the measured surface is transparent. It is never presented as compatibility with
  AWS.
