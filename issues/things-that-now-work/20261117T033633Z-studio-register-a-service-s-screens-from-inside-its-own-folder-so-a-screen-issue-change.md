Issue-Id: 386
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|aws-area.screens|register-inside-service-folder
Issue-Check-Ids: studio.aws-clients-of-any-service-go-through-the-engine studio.aws-sqs-client-keeps-a-queue-url-on-the-engine
Issue-Commit: 3002fc508f1ef0559c3cc63c7a3801b66cd34066

# Register a service's screens from inside its own folder so a screen issue changes no file the services share

> Identified against commit `3002fc508f1ef0559c3cc63c7a3801b66cd34066`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

An issue that builds a screen of one AWS service changes files every service shares. The screen is entered in
`studio/src/providers/aws/area/screens.ts` (`SCREENS`), and a service's first screen also adds its SDK client to
`studio/src/lib/aws/client-factory.ts`, `studio/package.json` and `studio/bun.lock`.

Issue 327 chooses the browser checks of a run by the service the changed paths touch, and a path the services
share calls for every service's checks. So while a screen is registered in a shared file, a screen issue's whole
check, and the push of `main` that carries it, still run every service's browser checks, and the step grows
with every service: the saving of issue 327 reaches only a branch that stays inside
`studio/src/providers/aws/area/services/<service>/`.

What could hold it, to be settled by the requirement: the area collects each service's screens from a file in
the service's own folder, so an issue that adds or changes a screen of a service whose client exists changes
only that folder (and its checks); whether a service's client can be made from inside its folder as well, with
the factory's rules (one place that sets the endpoint, the session and the placeholder credential) kept; and
whether the clients of the services `studio/src/providers/aws/services.ts` lists are installed once, ahead of
their screens.

## Evidence

- `.pm/issue-327/probe/scope-today.txt`: the paths of `feat/56-s3` against `main` (the first S3 screen) hold
  `studio/src/providers/aws/area/screens.ts` beside the files under `services/s3/`.
- `.pm/issue-69/breakdown.md`, units `s2`, `s3`, `s4`: `studio/package.json`, `studio/bun.lock`,
  `studio/src/lib/aws/client-factory.ts`, and an entry in `screens.ts` per screen. `.pm/issue-70/breakdown.md`,
  units `s2` to `s5`: the same files.
- `.pm/issue-327/requirement.md`, R2 (the paths that call for every service) and N1.

## Steps to Reproduce

1. On an issue branch that adds one screen to a service, `git diff --name-only main...HEAD`.
2. The list holds `studio/src/providers/aws/area/screens.ts`.

## Expected

- An issue that adds or changes a screen of a service whose client exists changes no file under `studio/src/`
  outside `studio/src/providers/aws/area/services/<service>/`, apart from unit test files.
- The area shows the same screens at the same paths as before, with the same crumbs, navigation and help.
- `pm-scope` on such a branch names that service alone (issue 327).

## Out of scope

- The rule from a path to a service and the choice of checks (issue 327).
- Any screen's content.
