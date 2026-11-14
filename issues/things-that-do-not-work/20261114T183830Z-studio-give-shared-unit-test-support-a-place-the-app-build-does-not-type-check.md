Issue-Id: 14
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|unit-test-support-location|layout
Issue-Check-Ids:
Issue-Commit: 6fbbdf204eedb190c4466fc3aa64e67b443844f0

# Give shared unit-test support a place the app build does not type-check

> Identified against commit `6fbbdf204eedb190c4466fc3aa64e67b443844f0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio has no shared home for unit-test support that several test files use. `studio/src/test/` holds only
`setup.ts`, and `studio/tsconfig.app.json` excludes just `src/**/*.test.ts`, `src/**/*.test.tsx` and `src/test`, so
any other shared helper is type-checked as app code. Issue 3's Home tests share a fake engine, answer builders and
a TanStack Query notification scheduler in `studio/src/features/home/home-test-kit.tsx`, which sits among product
files and is compiled by the app project. `studio/AGENTS.md` says "Fixtures exist only inside tests".
The reference is the layout `studio/AGENTS.md` sets for `src/` and the split between `tsconfig.app.json` and
`tsconfig.test.json`.

## Evidence

- `studio/tsconfig.app.json` line 25: `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test"]`.
- `studio/src/features/home/home-test-kit.tsx` is imported only by `*.test.ts(x)` files
  (`grep -rl home-test-kit studio/src`), yet `bun run typecheck` checks it with the app project.
- Review `.pm/issue-3/review-impl-s3-r1.md` P2 2.

## Steps to Reproduce

1. `cd studio && grep -rl home-test-kit src` lists only test files and the kit itself.
2. `bunx tsc -p tsconfig.app.json --listFilesOnly | grep home-test-kit` lists the kit as part of the app program.

## Expected

- Shared unit-test support lives in one place that the app project does not compile and the test project does.
- No file under `studio/src/features`, `studio/src/lib`, `studio/src/components` or `studio/src/app` holds a
  fixture or fake used only by tests.
- The five `studio/` scripts still pass, and the moved helpers are used from their new place.

## Out of scope

The tests themselves and what they assert; only where their shared support lives.
