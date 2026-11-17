Issue-Id: 417
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|services-list|tests-pin-count
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Stop Studio's tests from writing the number of services out, so adding a service changes one table

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Issue 245 is the first to add a service to `studio/src/providers/aws/services.ts`. To do so it has to rewrite confirmed unit cases and flow checks that write the list of services out again or pin its length, in eight files; every later service (the owner's scope is every service the emulator supports) meets the same rewrite and the same merge conflicts between issues that run in parallel.

## Evidence
```
$ grep -rnEi "\b(19|nineteen)\b" studio/src tests/integration/studio   (on main, 39a97fc)
studio/src/app/routes.test.tsx:111, 119   "Services" (19), '(19)'
studio/src/app/provider-list.test.ts:95   "the AWS entry's 19 services"
studio/src/providers/aws/services.test.ts:33, 34   'are 19', toHaveLength(19)
studio/src/providers/aws/area/area-layout.test.tsx:309, 660, 671, 1005   "the 19 services", '(19)'
studio/src/features/home/home-page.test.tsx:312, 317, 322   "19 services · no Studio screen yet"
tests/integration/studio/home.spec.ts:401   "lists the 19 services"
tests/integration/studio/support/wrapping.ts:92   'a provider\'s "19 services · …"'
tests/integration/studio/support/home.ts:115   "The 19 service labels"
The table of labels and paths is written out again in routes.test.tsx, provider-list.test.ts, area-layout.test.tsx, home-page.test.tsx, services.test.ts and support/home.ts.
```

## Steps to Reproduce
1. Add one entry to `SERVICES` in `studio/src/providers/aws/services.ts`.
2. Run Studio's unit tests.
3. Cases in five test files fail, each for the list's length or its table; the flow checks that read `SERVICE_LABELS` fail the same way.

## Expected
- The expected list of services is written once for the unit cases and once for the flow checks (which may not import Studio's code), and every case and check reads it from there.
- No case or check title, and no assertion, holds the number of services as a literal; a case that needs the number takes the expected list's length.
- Adding a service then changes `services.ts`, the two expected lists, and nothing else; every case still fails when `services.ts` and the expected list disagree.

## Out of scope
Which services Studio lists. The shared example of a service without a screen (`no-screen.ts`).
