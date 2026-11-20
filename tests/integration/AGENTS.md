# tests/integration

What holds for every integration check. The root `AGENTS.md` applies first. Which checks belong to a service, and
the manifest's two files and fields, are in `references/services-and-manifest.md`.

These checks are the project's ground truth. They run against a real aws-emulator and decide whether an issue
is closed. The issue's `plan` writes them after the implementation review, from the scenarios of
`test-criteria.md` confirmed before the build. The worker whose code they test never writes or changes them.

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
  issue branch. After the plan runs the affected checks, `rev` reviews the integration changes against the
  scenarios. A scenario left out says why, in `test-criteria.md` or the plan's `report.md`. See the PM skill's
  `references/lead.md` for the stage order and omissions.
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
- A test does not assert how many entries a list has when the list grows with the product (services, manifest rows);
  it asserts the property the number stood in for (each entry well formed, two lists equal, no entry twice by its
  key, the list not empty). A number that is the behaviour under test stays (a page of `MaxItems` 10).

## Studio checks and language

- The Studio flow checks run with an English browser: `locale: 'en-US'` in `studio/playwright.config.ts` and in
  every browser context the support code opens for a check that is not about a language, so no check depends on
  the machine's language. `studio.checks-browser-language-is-english` guards it.
- A check reads Studio's English text unless it is about a language. A check about a language sets it itself, with
  its context's `locale` or a storage state that holds `emuforge.studio.language` for Studio's origin, never with a
  change of Studio's code or catalogues.
- A check that reads another language's text reads it from Studio's catalogue files (`studio/src/i18n/messages/`)
  at run time and matches by value; it holds no copy of a translation and names no message key.

## Studio checks: what they find and when they assert

A check passes or fails by what the product does, on a fast and on a slow machine. What a Cloudscape component
draws inside itself, and when, is Cloudscape's: a `Header` writes its counter into the `h1` once the list is read,
a highlighted option holds its label twice (issue 551). A check that matches those strings fails by timing.

- **Inside a Cloudscape component** (a select's, multiselect's or autosuggest's options, a table's rows, cells and
  loading text, a header's heading text and counter, a flash, a modal, a form field's error) an element is found
  with Cloudscape's test selectors, `@cloudscape-design/components/test-utils/selectors`
  (`createWrapper().findTable().findRows()`, `findHeader().findHeadingText()`, `findFlashbar().findItemsByType()`,
  `findFormField().findError()`, `findModal()`), made a locator with `toSelector()`. A check adds no string
  condition of its own to find it.
- **An option** is chosen by its value, `findDropdown().findOptionByValue(<value>)`, never by its text. When the
  scenario's line asserts the label, the check asserts it on the option it found by value.
- **Elsewhere** an element is found by role and accessible name, `getByRole(<role>, { name })`. `exact: true` and a
  whole-text pattern (`^…$`) are used only when that string is what the scenario's line asserts.
- **The settled screen.** An assertion is made on the screen once it has settled: the loading text gone, the list
  or value the line is about shown. A state in between (loading, a transition, a spinner, a button disabled while a
  request is out) is asserted only when the scenario's line is about it.
- **Going on.** What lets the next action go ahead is something shown on the screen (a row, a value, the dialog
  closed, the button enabled), never a time. A bound is how long the check waits for that, never a wait itself.
- Selectors shared by a service's checks live in its support file, those of every check in `support/`
  (`references/services-and-manifest.md`); a check does not build its own copy.

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
print the count left out (`full tier <n> of <m> left out`). Apart from an environment case (below), the label is
given and removed only by the `pm`, with the owner's word and the reason in the issue's `decisions.md`; a plan or a
worker never labels a check to shorten a run. A row is never labelled both `full` and `on-request`: `run` refuses such a manifest before anything starts.

An environment case is of the tier full, always (owner, 2026-11-20, issue 569): a check whose scenario is the
emulator or the engine stopped, killed, restarted, not there, not reachable, or coming up late. The plan writes its
row labelled `full` from the start; such a case is never written for the push run of `main.yml` or the whole check
of an issue, and a new service's plan does not bring one back. A check whose task is the developer's own (testing a
connection, stopping the product) or whose property is safety stays out of the tier though it stops something.

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
