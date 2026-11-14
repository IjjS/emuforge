Issue-Id: 11
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|unit-test-aws-shared-files|gap
Issue-Check-Ids: studio.unit-tests-read-no-aws-shared-files
Issue-Commit: 0c6d672431ff042e655e4415e54c5def81d7390a

# Redirect the AWS shared config files for every Studio unit test

> Identified against commit `0c6d672431ff042e655e4415e54c5def81d7390a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Under Vitest the AWS SDK for JavaScript v3 loads its Node runtime configuration, not the browser one Studio ships
with. For every setting a client leaves at its default (user agent app id, retry mode, max attempts, checksum
settings, defaults mode), that configuration reads environment variables and the shared AWS files,
`$HOME/.aws/config` and `$HOME/.aws/credentials`. The root `AGENTS.md` forbids reading those files.
`studio/src/lib/aws/client-factory.test.ts` points `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` at missing
files, but only in its own `beforeEach`. Any other unit test that creates a client through the factory (a
service's `api.ts` tests, for example) reads the developer's real `~/.aws/config` during `bun run test:unit`.
The reference is the browser build: there the SDK reads no file at all.

## Evidence

A throwaway Vitest case (removed afterwards; output in the s4 worktree's
`output/logs/probe-shared-config.log`) set `HOME` to a scratch directory holding a fake `.aws/config` with
`sdk_ua_app_id = emuforge-probe-marker`, without redirecting `AWS_CONFIG_FILE`. It then built
`ListStateMachines` through `createSfnClient({ endpoint: engineEndpoint(8314) })`. The built request's headers
contained `emuforge-probe-marker`, so the client had read `$HOME/.aws/config`. Result: `Tests 1 passed (1)`.

## Steps to Reproduce

1. In `studio/`, add a unit test outside `src/lib/aws/client-factory.test.ts` that sets `HOME` (with `vi.stubEnv`)
   to a directory whose `.aws/config` is `[default]` plus `sdk_ua_app_id = <marker>`.
2. In it, create a client with `createSfnClient`, send `ListStateMachinesCommand`, and capture the request at the
   last `deserialize` middleware before it is sent.
3. `bun run test:unit`: the captured headers carry `<marker>`.

## Expected

- In any Studio unit test file, a client created through the factory reads neither `$HOME/.aws/config` nor
  `$HOME/.aws/credentials`. The case of step 1 finds no marker in the request.
- The redirect applies to every unit test file without that file setting it itself.

## Out of scope

- The browser build, which reads no file.
- The factory's choice of credential (issue #2's Studio-origin follow-up).
