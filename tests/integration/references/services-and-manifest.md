# A service's checks, and the manifest

Read this when writing or reading a check of one service's screens, or a manifest row. The rules of every check are
in `tests/integration/AGENTS.md`.

## Service checks

A check that drives the screens of one service has the field `service` in the manifest: the name of that
service's folder under `studio/src/providers/aws/area/services/` (`s3`, `apigateway`), of the form
`[a-z][a-z0-9]*(-[a-z0-9]+)*`. It is given by the plan that writes the check, reviewed by `rev` with it, and
changed after that only by the `pm`; a check of the engine, of shared Studio code or of more than one service
has no `service`, and giving it to another check to shorten a run is a defect. A check of no service is part of
every run, unless it is labelled `full` or `on-request` (`tests/integration/AGENTS.md`); so is a check of a touched
service. `run --services <file>` leaves out the checks of the services the file does not list: the whole check
of a branch and the push run of `main.yml` hold the checks of the services their changes touch, and every
service's when a shared path changed. So a service no change touched is not checked until the whole set runs
again in `.github/workflows/full.yml`, which the owner starts by hand: until then a change inside one service
that breaks another service's screen, or a service check that depends on a shared path no other check covers, is
not seen.

Everything of a service's checks other than its check files lives in `tests/integration/studio/services/<service>/`:
its support (direct calls, seeding, cleanup, locators, texts), its seed script and its `manifest.jsonl`
(Manifest). The check files stay directly under `studio/`. The plan of a service issue writes its helpers and rows
there, not in `support/` or the main `manifest.jsonl`. A changed path under `services/<service>/`
calls for that service's checks alone, as a path of its screens does. A changed path under `support/` calls for
every service's checks, so support that the checks of more than one service, or a check of no service, read stays
in `support/` (`support/service-screens.ts` holds what a service's support lends to others), and
`support/index.ts` exports nothing of a service's folder. A file of a service's folder may import shared support. A
check file of a service is one every one of whose rows has that `service`. `run` refuses to start, before anything
is built and with every check `error`, when a `.ts` file under `studio/` imports a file of a service's folder and
is neither in that service's folder nor one of its check files, and when any file imports a `.spec.ts` file.

## Manifest

The rows of a service's checks are the lines of `studio/services/<service>/manifest.jsonl`, each with that
`service`, `module` `studio` and a `path` directly under `studio/`; `manifest.jsonl` holds the rows of the others,
every check of no service. The manifest is the rows of both: `manifest.jsonl` in its order, then each service's
file, the services in name order (a folder without one adds no row), and every reader reads it so: `run`,
`pm-check --checks`, the selection of `pm-scope`, `pm-check` and `pm-merge`, and `.github/ci`. In a checkout that
holds `studio/services/`, `run` refuses to start when a row of `manifest.jsonl` has a `service`, when a row of a
service's file has another `service`, another `module` or a `path` that is not a `.spec.ts` directly under
`studio/`, and when two rows hold one id.

One JSON object per line:

| Field | Meaning |
|---|---|
| `check_id` | `<module>.<slug>` |
| `path` | file that holds the check |
| `module` | `engine`, `cli`, `iam`, `verify`, `studio` |
| `operations` | AWS operations it calls, as `<service>:<Operation>` |
| `labels` | any of `transparency`, `own-emulator`, `safety`, `regression`, `lifecycle`, `on-request`, `full` (the tier full: only in `full.yml` and a run the owner asks for, `AGENTS.md`); never both `on-request` and `full` |
| `issue` | the `Issue-Id` it was written for |
| `service` | the one service whose screens the check drives, as the name of its folder under `studio/src/providers/aws/area/services/`; absent for every other check (Service checks); a row that has it is in that service's `manifest.jsonl` |
| `emulator_gap` | set when the reference behavior depends on an operation the emulator answers with 501; the check then asserts the 501 path |
