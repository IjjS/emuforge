Issue-Id: 302
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|pm-structure|route-parameter-from-seeded-emulator
Issue-Check-Ids: harness.route-param
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Let pm-structure score a screen whose route holds an id the emulator assigns

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-structure` opens BASE + the reference spec's literal `route` (`.pm/bin/pm-structure`, its usage text: "--url
BASE opens BASE + the spec's route"). A resource's own page has the resource's id in its route, and for most
services the emulator assigns that id when the resource is created (an API Gateway REST API's id is ten random
characters), so no fixed route in a spec can name a resource that exists in the seeded emulator. Such a screen
cannot be scored, and `studio/references/workflow.md` requires a structure score for every `console` screen.

The S3 bucket list (issue 56) and the three screens of issue 69 have fixed routes, so this did not show before.
It blocks the own page of every resource whose id the emulator assigns, in every service; the first is the API
Gateway REST API's page, which issue 69's plan cut out for this reason.

What is missing: a way for a spec's route to hold a parameter (for example `/aws/apigateway/apis/{id}`) and for
a scoring run to fill it with the id of a resource of the seeded emulator, the same on every run of the same
seed, so "the same build, seed and spec always give the same score" still holds
(`studio/references/console-reference.md`, "Structure score"). How the seed names the resource is for this
issue's requirement to say.

## Evidence

- `.pm/bin/pm-structure`, usage text: "--url BASE opens BASE + the spec's route"; `.pm/bin/_pmspec.py` reads
  `route` as one string that must start with `/` and has no placeholder syntax.
- aws-emulator 1.0.481 (release 2026.11.16, commit `677eff0e`), called directly for the plan of issue 69 on 2026-11-17 (scripts and full output in the main checkout under `.pm/issue-69/probe/`, outside git): two `apigateway create-rest-api --name probe69-regional` calls returned two different ids of ten
  random characters (`probe-1.log`), and `get-rest-api` answers only by that id.
- `studio/references/console-reference.md`: "Open the spec's `route` in the built app at 1280x800 against a
  seeded emulator".

## Steps to Reproduce

1. Write a `kind: detail` spec whose screen shows one REST API, with the route `/aws/apigateway/apis/<id>`.
2. Seed an emulator with a REST API; its id differs on every seed.
3. `pm-structure <worktree> <spec> --serve <dist>`: no route written in the spec opens the seeded API's page.

## Expected

- A spec's `route` may hold a named parameter, and a scoring run opens the route with the parameter filled
  from the seeded emulator; the report names the route it opened.
- A spec without a parameter is scored exactly as today; the existing specs' scores do not change.
- A parameter that cannot be filled is an error (exit 2), never a pass or a fail.
- `studio/references/console-reference.md` describes the parameter; the harness tests cover it.

## Out of scope

- Any Studio screen. The API Gateway REST API's own page is its own issue and depends on this one.
- Wizard steps (`?step=<k>`), which are scored as today.
