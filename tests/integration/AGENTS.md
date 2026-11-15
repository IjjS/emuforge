# tests/integration

Guidance for agents working in `tests/integration/`. The root `AGENTS.md` applies first.

These checks are the project's ground truth. They run against a real aws-emulator and decide whether an issue
is closed. They are written from a confirmed requirement, before the code they test, and the worker whose code
they test does not change them.

```
tests/integration/
  engine/          Rust: engine, CLI, IAM and Verify checks
  studio/          Playwright: flows through the built Studio
  manifest.jsonl   one row per check
```

## Who edits

- A check is added at the Test Criteria stage of its issue and reviewed by `rev` before implementation starts.
- After that, only the `pm` changes it, with the reason in the issue's `decisions.md`. A check that turns out
  to be wrong is fixed in the open, never by loosening an assertion until it passes.
- A worker may add helper code under a `support/` folder that its unit owns. It never edits an assertion.

## A check

- Has an id `<module>.<slug>`: `engine.relay-s3-put-object-streams-body`, `studio.s3-create-bucket-appears-in-list`.
- Tests one behavior and says in its name what that is.
- Asserts what a caller observes and, where state changed, what the emulator reports afterwards.
- Leaves nothing behind: it registers cleanup for everything it creates.
- Never depends on another check having run, or on run order.
- Has no sleep. It waits on a condition with a bound.

## Studio checks and language

- The Studio flow checks run with an English browser: `locale: 'en-US'` in `studio/playwright.config.ts` and in
  every browser context the support code opens for a check that is not about a language, so no check depends on
  the machine's language. `studio.checks-browser-language-is-english` guards it.
- A check reads Studio's English text unless it is about a language. A check about a language sets it itself, with
  its context's `locale` or a storage state that holds `emuforge.studio.language` for Studio's origin, never with a
  change of Studio's code or catalogues.
- A check that reads another language's text reads it from Studio's catalogue files (`studio/src/i18n/messages/`)
  at run time and matches by value; it holds no copy of a translation and names no message key.

## Isolation

The emulator has no reset and keeps everything in memory, so isolation is the check's job.

- Every resource name carries a prefix unique to the check run.
- A check that changes something an account has only one of (account settings, a default resource) gets its
  own emulator on its own port and is labelled `own-emulator`.
- The emulator version is pinned for a run and recorded in the report. Releases arrive many times a day; a
  result without the version cannot be compared with another.

## Safety

- The only endpoints are the engine and the emulator on a loopback IP address. A check that would reach any
  other host is refused before it runs.
- Checks run without the AWS credentials, profiles and proxy settings of the environment.
- Signing uses the keys the emulator wrote for this run and nothing else.

## Manifest

One JSON object per line in `manifest.jsonl`:

| Field | Meaning |
|---|---|
| `check_id` | `<module>.<slug>` |
| `path` | file that holds the check |
| `module` | `engine`, `cli`, `iam`, `verify`, `studio` |
| `operations` | AWS operations it calls, as `<service>:<Operation>` |
| `labels` | any of `transparency`, `own-emulator`, `safety`, `regression`, `lifecycle` |
| `issue` | the `Issue-Id` it was written for |
| `emulator_gap` | set when the reference behavior depends on an operation the emulator answers with 501; the check then asserts the 501 path |

## Verdicts

| Verdict | Meaning |
|---|---|
| `passed` | every assertion held |
| `failed` | an assertion did not hold, or the check timed out |
| `error` | anything else: the emulator would not start, a tool is missing |

`error` is never counted as `failed` or `passed`; it is reported and the run is not used as evidence.

A failing check that no open issue lists in `Issue-Check-Ids` becomes a new issue file. That is how gaps are
found; nobody decides by reading code that something is probably broken.
