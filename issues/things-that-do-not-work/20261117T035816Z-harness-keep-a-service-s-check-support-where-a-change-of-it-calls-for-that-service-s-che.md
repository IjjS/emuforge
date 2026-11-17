Issue-Id: 402
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|integration.studio-support|service-support-calls-for-every-service
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Keep a service's check support where a change of it calls for that service's checks alone

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 327 chooses the browser checks of a run by the service the changed paths touch, and issue 386 lets a screen
issue stay inside its service's folder in Studio. One shared path is left on every screen issue's branch: the
checks' support. A service's flow checks keep their direct calls, seeding, cleanup and locators in
`tests/integration/studio/support/<service>.ts`, exported through `support/index.ts`, and issue 327's rule
(requirement R2, line 6) answers a change anywhere under a `support/` folder with every service, because
`support/index.ts` re-exports each file to every check.

So the `t` units of a service issue, and with them the issue's whole check and the push of `main` that carries
it, still run every service's browser checks, although the issue changes nothing another service's check reads.

What could hold it, to be settled by the requirement: a place for one service's support that no other check
imports (a folder per service that `support/index.ts` does not re-export, guarded by a check of the imports), and
a line of the rule from a path to a service that gives such a path its service.

## Evidence

- `.pm/issue-327/requirement.md`, R2, line 6: "everything under the checks' `support/` folders (a service's own
  `support/<s>.ts` included: `support/index.ts` re-exports it to every check, `feat/56-s3`)".
- `git diff --stat main...feat/56-s3`: `tests/integration/studio/support/s3.ts` and
  `tests/integration/studio/support/index.ts` beside the three `s3-*.spec.ts`.
- `.pm/issue-69/breakdown.md`, units `t2` and `t3`; `.pm/issue-70/breakdown.md`, unit `t1`: each adds
  `support/<service>.ts` and its export in `support/index.ts`.
- `.pm/issue-386/requirement.md`, R9: what a screen issue's branch still touches outside its service once issue
  386 is built.

## Steps to Reproduce

1. On a branch that adds `tests/integration/studio/support/<service>.ts` and one line to `support/index.ts`
   beside that service's check files, run `pm-scope` (with issue 327 built).
2. The `services` line reads `every service`.

## Expected

- A branch that changes only one service's screens, its check files and that service's own check support makes
  `pm-scope` name that service alone.
- No check of another service, and no check of no service, imports a service's own support; a check guards it.
- A change of support that several checks share still calls for every service.

## Out of scope

- Studio's side (issue 386).
- The rule's other lines (issue 327).
