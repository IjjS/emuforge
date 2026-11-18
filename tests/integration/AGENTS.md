# tests/integration

What holds for every integration check. The root `AGENTS.md` applies first. Which checks belong to a service, and
the manifest's two files and fields, are in `references/services-and-manifest.md`.

These checks are the project's ground truth. They run against a real aws-emulator and decide whether an issue
is closed. The issue's `plan` writes them after the build, from the scenarios of `test-criteria.md` confirmed before
it, and the worker whose code they test never writes or changes them.

```
tests/integration/
  engine/          Rust: engine, CLI, IAM and Verify checks
  studio/          Playwright: flows through the built Studio
    support/               shared support of the Studio checks
    services/<service>/    one service's support, seed script and manifest.jsonl
  manifest.jsonl   one row per check of no service
  references/      services-and-manifest.md: a service's checks, the manifest's files and fields
```

## Who edits

- The `plan` writes an issue's checks, their helper code and their manifest rows, in the issue's worktree on its
  issue branch, after every unit is merged; `rev` reviews whether they are the scenarios. A scenario left out says
  why, in `test-criteria.md` or the plan's `report.md`.
- A check that does not do what its scenario says is fixed by the plan, with the reason under `## Plan decisions`.
  A scenario that is wrong, and any check once its issue is merged, is changed only on the `pm`'s decision, with the
  reason in the issue's `decisions.md`. A check is never fixed by loosening an assertion until it passes.
- A worker writes no integration check and edits no helper code here: shared helper code under `support/`, one
  service's helpers under `studio/services/<service>/`, are the plan's (`references/services-and-manifest.md`).

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

## On request

A check labelled `on-request` in the manifest is not part of a default run: `run` leaves it out and reports it
`not-run` with the reason `on request: not part of a default run; run it with --on-request`. `run --on-request` and
`pm-check --on-request` run it with the others, and `pm-check --checks <id>` runs it alone. The label is given and
removed only by the `pm`, with the owner's word and the reason in the issue's `decisions.md`; a plan or a worker
never labels a check to shorten a run. A check an open issue lists in `Issue-Check-Ids` is not on request: the
plan of the issue that comes to list one takes the label off with its integration tests, and runs it with
`pm-check --checks` until then.

## Safety

- The only endpoints are the engine and the emulator on a loopback IP address. A check that would reach any
  other host is refused before it runs.
- Checks run without the AWS credentials, profiles and proxy settings of the environment.
- Signing uses the keys the emulator wrote for this run and nothing else.

## Full tier

A check labelled `full` in the manifest is an auxiliary check, slow and not critical: a language's layout and
words, the brand's layout, a screen's keyboard and layout, a screen's stop, restart and engine away. It runs only in
`.github/workflows/full.yml`, which the owner starts, and in a local run the owner asks for: `run --full`,
`pm-check --full`, or `pm-check --checks` naming it. Every other run leaves it out and reports it `not-run` with the
reason `full: runs only in the full run; run it with --full`; no service, check file or changed path calls it, so
neither a push run of `main.yml` nor the whole check of an issue holds it. No agent runs the tier on its own: a
plan, a worker or the `pm` runs `--full` or `--checks` of a check of the tier only on the owner's word, and the
report of an issue need not name it. `report.json` holds `full_tier` `{of, left_out}`, and `run` and `pm-check`
print the count left out (`full tier <n> of <m> left out`). The label is given and removed only by the `pm`, with
the owner's word and the reason in the issue's `decisions.md`; a plan or a worker never labels a check to shorten a
run. A row is never labelled both `full` and `on-request`: `run` refuses such a manifest before anything starts.

## Verdicts

| Verdict | Meaning |
|---|---|
| `passed` | every assertion held |
| `failed` | an assertion did not hold, or the check timed out |
| `error` | anything else: the emulator would not start, a tool is missing |
| `not-run` | not executed: listed in the file given to `run --not-run` (`.github/not-run.json`), labelled `on-request` in a run without `--on-request`, labelled `full` in a run without `--full`, or a check of a service the run's changes do not touch (`run --services`, `references/services-and-manifest.md`); never counted as `passed` or `failed`. The list and the label are changed only on the `pm`'s decision, with the reason in the issue's `decisions.md` |

`error` is never counted as `failed` or `passed`; it is reported and the run is not used as evidence. A `not-run`
check says nothing about the behavior it covers.

A failing check that no open issue lists in `Issue-Check-Ids` becomes a new issue file. That is how gaps are
found; nobody decides by reading code that something is probably broken.
