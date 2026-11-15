Issue-Id: 40
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|test-unit|stale-glob-in-vitest-module-cache
Issue-Check-Ids:
Issue-Commit: d8120a19d4f696b3deee2dc9c4ed263fccdd6ed7

# Keep a hand run of Studio's unit tests from reusing a cached glob that predates added files

> Identified against commit `d8120a19d4f696b3deee2dc9c4ed263fccdd6ed7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`bun run test:unit` in `studio/` is `vitest run`. Vitest 5.0.5 keeps every transformed module on disk in
`studio/node_modules/.vitest-cache` (`fsModuleCache`, on by default) under a key made of the module's path, its own
text and the configuration. `studio/src/i18n/bundled.ts` finds the catalogues with
`import.meta.glob<unknown>('./messages/*.json', …)`. The list of files the glob matched is written into the cached
module, but is no part of its key, so a later run in a tree where more files match is given the earlier list. Vitest
leaves a module with a glob out of the cache only when its text holds `import.meta.glob(`; the type argument
(`glob<unknown>(`) hides it. `studio/src/i18n/catalogues.test.ts:218` has a glob of the same form.

So a run by hand reports an earlier tree in both directions: a correct tree fails after files were added, and a
tree that should fail passes. The reference is the same command with the cache not used
(`bun run test:unit --fsModuleCache=false`), which reports the files on disk.

Issue #33 covers `pm-check`'s `studio-unit` step, whose result is the evidence. This issue is the command as a
person or a worker runs it by hand in `studio/`, which #33 leaves as it is.

## Evidence

All under `.pm/issue-33/` of the main checkout, measured on a copy of `main`'s `studio/` at `d8120a1`
(`repro/repro.sh`), Vitest 5.0.5, bun 1.4.4.

- `logs/repro-summary.txt`: with the cache written while `en.json` was the only catalogue and the other eleven then
  restored, `bun run test:unit` fails 43 tests in 6 files (`logs/repro-2-twelve-cache-in-place.log`, for example
  `expected [ 'English' ] to deeply equal [ 'Deutsch', 'English', …(10) ]`); the same tree with
  `--fsModuleCache=false` fails only the one case that needs a git checkout, which the copy is not
  (`logs/repro-3-twelve-cache-off.log`).
- `logs/stale-pass-summary.txt`: from an empty cache `src/i18n/catalogues.test.ts` passes with twelve catalogues;
  with a thirteenth file added it still passes with the cache in place (`stale-pass-2-…`) and fails without it
  (`stale-pass-3-…`, the case "exactly twelve"). After a catalogue is removed and put back, the cached run fails
  on a correct tree (`stale-pass-6-…`) and the run without the cache passes (`stale-pass-7-…`).
- `logs/cause-cache-entry.txt` and `.pm/issue-33/requirement.md` section 3: the cached module of `bundled.ts`
  imports `en.json` alone.

## Steps to Reproduce

1. In `studio/`, with `node_modules/.vitest-cache` empty, run `bun run test:unit src/i18n/catalogues.test.ts`: it
   passes.
2. Copy `src/i18n/messages/de.json` to `src/i18n/messages/nl.json` and run the same command: it still passes.
3. Run `bun run test:unit src/i18n/catalogues.test.ts --fsModuleCache=false`: the case "the catalogue files →
   exactly twelve" fails. Remove `nl.json`.

## Expected

- `bun run test:unit` in `studio/` reports the files on disk: after a file that an `import.meta.glob` of Studio
  matches is added, the run sees it, whatever an earlier run left in `node_modules/.vitest-cache`.

## Out of scope

`pm-check`'s `studio-unit` step (issue #33). Vitest's own rule for which modules it caches (upstream).
