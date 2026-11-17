Issue-Id: 463
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|s3-api-test-abort-signal|flaky
Issue-Check-Ids:
Issue-Commit: ad891af82adfea87e250b0b7501b7a0679bf73df

# Wait for the aborted signal in the S3 api case of GetBucketVersioning's abort

> Identified against commit `ad891af82adfea87e250b0b7501b7a0679bf73df`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The unit case "the caller’s abort signal > is given to the request of GetBucketVersioning, which ends with its reason
at once" of `studio/src/providers/aws/area/services/s3/api.test.ts` (issue 256, unit s1, on `feat/256`) fails on some
runs and passes on others with the same code. Its last assertion reads whether the request the fake engine received
has an aborted signal right after the call has rejected; the call rejects with the abort's reason at once, and the
abort reaches the request the fetch sent a moment later, so the assertion can read it before it has arrived. The
reference is the case's own line in issue 256's `test-criteria.md` ("Unit — services/s3/api.test.ts"): the request
is given the caller's signal and ends with its reason at once, on every run.

## Evidence

- `pm-check` on `feat/256-s2` at ad891af: `studio-unit` recorded `flaky` in `output/checks/last.json` of the worktree
  `emuforge-256-s2`, and in `.pm/run/flakes.jsonl`.
- First attempt's log `output/logs/check-studio-unit.attempt1.log` of that worktree: `AssertionError: expected false
  to be true` at `api.test.ts:954`, `expect(engine.sent[0]?.signal.aborted).toBe(true)`; the second attempt passed.
- Review `impl-s2 r1` (`.pm/issue-256/review-impl-s2-r1.md`, P2) found the same.

## Steps to Reproduce

1. In `studio/` of a checkout of `feat/256` (or of `main` once issue 256 is merged), with the machine busy (other
   test runs at the same time), run `bun run test:unit -- src/providers/aws/area/services/s3/api.test.ts` several
   times.
2. Some runs fail the case above at line 954; the others pass.

## Expected

- The case passes on every run, under load as well, with its assertions as the criteria line states them (the
  request's signal is aborted, and the call ends with the reason at once).
- `pm-check` records `studio-unit` as `passed`, not `flaky`, on a commit that holds the case.

## Out of scope

`sendRequest` of `studio/src/lib/aws/request.ts` and the behaviour of the S3 reads: the case's subject works; only
when the case reads the request's signal is in question.
