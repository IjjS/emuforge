Issue-Id: 33
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: worker
Issue-Key: harness|pm-check-studio-unit|stale-vitest-cache-after-merge
Issue-Check-Ids:
Issue-Commit: 0b0337746e336192a742776f97cb40e5b758776c

# Keep pm-check's studio unit run from reusing a vitest cache that predates a merge

> Identified against commit `0b0337746e336192a742776f97cb40e5b758776c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`pm-check` runs Studio's unit tests with `bun run test:unit` (`vitest run`) in the worktree, which reuses the
persistent cache in `studio/node_modules/.vitest-cache`. After `main` was merged into `feat/17-h1` (merge `165fdb1`),
the merge added eleven catalogue files to `studio/src/i18n/messages/`, next to the `en.json` the branch already had.
`studio/src/i18n/bundled.ts` finds the catalogues with `import.meta.glob('./messages/*.json', { eager: true })`. The
cached run still resolved that glob to `en.json` alone, so every test that needs a language other than English failed
(39 failures in 5 files), although the tree on disk was correct. With the cache directory moved away, the same tree
passed every test (25 files, 1159 tests). A check run that reports the state of an earlier tree is not evidence about
the commit it names.

## Evidence

- `output/logs/pm-check-5.out` and `output/logs/check-studio-unit.log` in the `feat/17-h1` worktree, commit `0b03377`:
  `NOT PASSED commit=0b0337746 failed=['studio-unit']`, first failure
  `the catalogue files → exactly twelve ...: expected [ 'en' ] to deeply equal [ 'de', 'en', 'es', ... ]`.
- `bun run test:unit` run again by hand in `studio/` with the cache in place: the same failures.
- After `node_modules/.vitest-cache` was moved out of the worktree: `Test Files 25 passed (25)`, `Tests 1159 passed (1159)`.

## Steps to Reproduce

1. In a worktree whose branch has only `studio/src/i18n/messages/en.json`, run `bun run test:unit` in `studio/` so the
   cache is written.
2. Merge a branch that adds more `messages/*.json` files (here `main` at `7b788ac` into `feat/17-h1` at `438d903`).
3. Run `pm-check` on the worktree again.

## Expected

The studio unit check runs against the files of the commit it reports: a file added by a merge is seen by
`import.meta.glob`, and the check's result does not depend on a cache written for an earlier tree.

## Out of scope

Studio's own code and tests; the integration and harness checks.
