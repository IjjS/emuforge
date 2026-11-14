Issue-Id: 7
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: plan
Issue-Key: engine|browser-access|missing
Issue-Check-Ids: engine.studio-session-serves-health engine.studio-port-from-environment engine.studio-session-changes-on-restart engine.studio-session-not-in-output
Issue-Commit: b6826962168941938001393417fa6f23f2acc5ce

# Serve engine routes to the Studio origin with a session token

> Identified against commit `b6826962168941938001393417fa6f23f2acc5ce`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio runs in a browser and must call the engine (issue #3 needs the health endpoint from issue #1, later every
AWS call). The engine is reachable from any web page the machine opens, so `engine/references/security-review.md`
rows B1-B4 require: only the Studio origin is served, CORS is never `*`, browser requests carry a session token
issued at engine start (never from a query string, never logged), and state-changing browser requests are
refused without it. Issue #1 serves no browser at all (it refuses any request with an `Origin` header), so there
is no way yet for Studio to obtain a token or to be allowed by origin.

Reference behavior: none in AWS; the rules are rows B1-B4 of `engine/references/security-review.md`.

## Evidence

```
$ ls engine
AGENTS.md  CLAUDE.md  README.md  references
```

Issue #1's plan (`.pm/issue-1/requirement.md`, Browser) leaves every `Origin` request refused; issue #3's
Expected needs the browser to reach the engine on `127.0.0.1`.

## Steps to Reproduce

1. Build issue #1.
2. Send `GET /__emuforge/health` with `Origin: http://127.0.0.1:<studio port>`.
3. The engine refuses it; there is no configuration naming the Studio origin and no token to send.

## Expected

- A request whose `Origin` is the configured Studio origin and that carries the session token is served, with
  CORS headers naming exactly that origin.
- A request with any other `Origin`, or with the Studio origin and no token, is refused; a token in a query string
  is not accepted.
- Studio can obtain the token without it being written to a log, a URL query string or the engine's output.
- The token never appears in the engine's logs.

## Out of scope

- Relaying AWS requests (issue #2).
- Studio screens (issue #3).
