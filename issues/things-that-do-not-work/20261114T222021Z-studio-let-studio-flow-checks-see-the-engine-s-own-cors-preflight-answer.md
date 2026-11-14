Issue-Id: 15
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|integration-support.browser-routing|preflight-answered-by-playwright
Issue-Check-Ids:
Issue-Commit: 53f12179789103f40939b66f4043091b05c6917f

# Let Studio flow checks see the engine's own CORS preflight answer

> Identified against commit `53f12179789103f40939b66f4043091b05c6917f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The Studio flow checks' browser context (`tests/integration/studio/support/check.ts`, the `context` fixture) installs
`context.route('**/*', ...)` for the loopback-only destination rule. With request interception on, Playwright 1.65.0
answers every CORS preflight (`OPTIONS` with `Access-Control-Request-Method`, initiator `preflight`) itself, with
`204`, `Access-Control-Allow-Origin: <the request's Origin>`, `Access-Control-Allow-Methods: <the requested method>`,
`Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Headers` echoing the request, and never lets it
reach the server (`studio/node_modules/playwright-core/lib/coreBundle.js`, `isInterceptedOptionsPreflight`).

So no Studio flow check can observe the preflight answer a real browser would get from the engine: a page `fetch`
with non-safelisted headers passes its preflight whatever the engine answers, and the engine never receives it.
The reference is a real Chromium page without interception, whose preflight goes to the engine and whose `fetch`
rejects when the engine refuses it (`.pm/issue-10/evidence/emulator-calls.txt`, §S.3, where a recording listener
received the preflight).

## Evidence

- `engine.studio-browser-reads-relayed-s3-answer` (issue 10) on main's engine, which answers a Studio preflight on a
  relayed path `403 OriginNotAllowed` (unit case `preflight_from_studio_on_a_relayed_path_is_403_with_cors` on main):
  the page's `fetch` of `PUT /<bucket>` with `authorization`, `x-amz-content-sha256`, `x-amz-date` and
  `x-emuforge-session` resolved with status `403` instead of rejecting at the preflight. Report:
  `output/integration/report.json` of the t10 worktree at 53f1217, check log
  `output/integration/logs/engine.studio-browser-reads-relayed-s3-answer.log` (kept at
  `output/logs/pm-check-1/` in `emuforge-10-t10`).
- Playwright 1.65.0 source, `lib/coreBundle.js`: under `isInterceptedOptionsPreflight && needsRequestInterception()`,
  `Fetch.fulfillRequest` with `responseCode: 204` and the headers above.

## Steps to Reproduce

1. Start the stack of `tests/integration/studio/support` (`startStack`) with main's engine at dfb45f3, which answers a
   preflight from the Studio origin on a relayed path `403 OriginNotAllowed`.
2. In a check's `page`, at the Studio origin, `fetch('http://127.0.0.1:<engine port>/<bucket>', { method: 'PUT',
   headers: { authorization: ..., 'x-amz-content-sha256': ..., 'x-amz-date': ..., 'x-emuforge-session': <token> } })`
   (as `engine.studio-browser-reads-relayed-s3-answer` does).
3. Observe: the promise resolves with status `403` and the engine's `OriginNotAllowed` body for the `PUT`; a
   preflight answered `403` by the engine would have made it reject.

## Expected

- A Studio flow check's page sends its CORS preflights to the engine: the engine receives the `OPTIONS` request, and
  a `fetch` whose preflight the engine answers `403` rejects.
- Requests to anything but a loopback address are still refused before they leave, and logged.
- The check that shows it (none exists yet, so `Issue-Check-Ids` is empty until #15's plan writes it): a Studio flow
  check whose page `fetch`es, with a non-safelisted header, a loopback test server that answers the preflight `403`;
  the promise must reject and the server must record the `OPTIONS` request. It fails today (Playwright answers the
  preflight `204`, the promise resolves) and passes once the fix lands.

## Out of scope

- The engine's preflight behavior itself (issue 10).
- Any other part of the destination rule or the check contract.
