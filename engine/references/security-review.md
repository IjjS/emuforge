# Engine security review

The engine runs on a developer's machine, next to real AWS credentials, and is reachable from any web page
that machine opens. Every engine change is read against this list: at the Design stage for the rows it
touches, and by `rev` at implementation review for all of them. A row is kept or the change is not merged;
there is no "accepted risk" recorded by an agent.

This is a list for a local testing tool. It does not make EmuForge a security boundary, and nothing in the
product may claim that passing here says anything about security on real AWS.

## Network

| Id | Rule | Checked by |
|---|---|---|
| N1 | Every listener binds `127.0.0.1` by default. Binding anything else needs an explicit option and prints a warning | unit test on the default; integration check from a non-loopback address |
| N2 | The only upstream is the emulator on a loopback IP address. A host name, a non-loopback address or an `amazonaws.com` name is refused at configuration, not at request time | unit test with each form |
| N3 | Redirects from upstream are never followed. A URL found in a response (a queue URL, a presigned URL, an endpoint) is never fetched by the engine | unit test with a redirect; code read |
| N4 | TLS verification to the emulator is always on and trusts only the emulator's `ca.pem`. No option turns it off | unit test that a wrong certificate fails; grep for `danger` |
| N5 | When the emulator cannot be reached the request fails. There is no fallback endpoint of any kind | integration check with the emulator stopped |

## Browser

| Id | Rule | Checked by |
|---|---|---|
| B1 | A request with an `Origin` header is served only when the origin is the Studio origin: on the engine port `http://127.0.0.1:<studio port>`; on the Studio port the request's own origin, whose host is a host that port accepts. CORS headers are never `*` | unit test per origin |
| B2 | The `Host` header must be a loopback address with the listener's own port; the Studio port also accepts a host name the user allowed at start (`--allow-host`), never one learned while running (defence against DNS rebinding) | unit test with a foreign host |
| B3 | A browser request carries the session token issued at engine start. The token is not accepted from a query string and is never written to a log | unit test; log capture |
| B4 | State-changing requests from the browser are refused without the token even when the origin matches | unit test |

## Credentials

| Id | Rule | Checked by |
|---|---|---|
| C1 | The engine reads credentials only from `~/.aws/emulator/<port>/` of a target's emulator. The one other file it reads and writes is its settings file `targets.json` (written through a temp file in the same folder, renamed over it), which holds no key, in a folder refused at or under `~/.aws`. It never opens `~/.aws/credentials` or `~/.aws/config` and never builds a default AWS credential chain | code read; test with a decoy profile present; the settings folder refused under `~/.aws`; the settings file searched for the key |
| C2 | Emulator keys never leave the engine: not in a response, a log, an error, a child's command line, or the browser | log and response capture in an integration check |
| C3 | Keys are re-read when the emulator's files change; a key from an earlier run is never reused after a failed signature | integration check across a restart |
| C4 | A caller is identified before anything is forwarded. A request that cannot be attributed is refused, not forwarded as root | unit test per caller kind |

## Processes and files

| Id | Rule | Checked by |
|---|---|---|
| P1 | A child process (AWS CLI, an IaC tool) is started with an argument array, never through a shell | code read: no `sh -c`, no string-built command |
| P2 | A child's environment is built from an allowlist. `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and the user's `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` are never inherited | unit test on the built environment |
| P3 | A child is given an endpoint that is the engine on loopback; the engine refuses to start it otherwise | unit test |
| P4 | A path that comes from a request, a resource name or an IaC file is canonicalized and must stay inside a directory the user named. An S3 key is never used as a local path | unit test with `..`, an absolute path and a symlink |
| P5 | Nothing is downloaded or installed without the user's explicit consent in that run, and never onto `PATH` | code read; integration check of the first-run prompt |

## Limits

| Id | Rule | Checked by |
|---|---|---|
| L1 | Every outbound call and every child process has a timeout | code read; unit test with a paused clock |
| L2 | Request bodies are streamed; anything buffered has a size cap checked before reading | unit test one byte past the cap |
| L3 | Concurrent requests and concurrent children are bounded | unit test at the limit and one past it |

## IAM

| Id | Rule | Checked by |
|---|---|---|
| I1 | A policy element the evaluator does not support never evaluates to allow. In enforce mode the request is denied and the response says which element | unit test per unsupported element |
| I2 | An explicit deny wins over any allow | fixed vectors |
| I3 | The decision is made before the request is re-signed; a denied request never reaches the emulator | integration check that the emulator state is unchanged |
| I4 | Turning IAM off changes policy evaluation only. Rows N, B, C, P and L hold in every mode | the same tests run with IAM off |

## Telemetry

| Id | Rule | Checked by |
|---|---|---|
| T1 | EmuForge sends nothing anywhere. There is no usage or error reporting | code read; integration check with outbound network blocked |
