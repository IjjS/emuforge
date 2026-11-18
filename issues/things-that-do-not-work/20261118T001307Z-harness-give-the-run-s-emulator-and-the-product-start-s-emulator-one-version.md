Issue-Id: 473
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|integration|emulator-version-of-the-run-and-of-the-product-start-differ
Issue-Check-Ids:
Issue-Commit: 3e36c96a2db31f77f893d9518d270975129c5fd1

# Give the run's emulator and the product start's emulator one version

> Identified against commit `3e36c96a2db31f77f893d9518d270975129c5fd1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration run pins the emulator version of the run from the local image `aws-emulator`
(`tests/integration/run`: `docker run --rm --entrypoint aws-emulator aws-emulator --version`), and the check
`engine.product-start-has-one-unpublished-emulator` asserts that the emulator the product start runs reports that
version. The product start builds its emulator image from `infra/aws-emulator/Dockerfile` (`pull_policy: build`),
which installs the newest package with no version named. The two agree only while Docker's build cache still
holds the layer the local image was built from.

On 2026-11-18 the whole check of issue 402 failed on that check in both runs: expected 1.0.481 (the local image,
tagged eleven hours earlier), received 1.0.498 (released 2026-11-17), with no change under `infra/` or to the
Compose file; the same check had passed three hours earlier for issue 467. The `pm` rebuilt the local image from
the Dockerfile (1.0.498) and the whole check passed, 223 of 223, against 1.0.498. On GitHub Actions the runner
builds both from one cold cache, so it does not happen there; the runner had 1.0.486 on 2026-11-17 while the
owner's machine had 1.0.481.

What the requirement has to settle: whether the Dockerfile names the version it installs (and who moves it, and
which checks run when it moves), or the run builds the local image and the product's emulator image from the same
layer, or the check reads the version another way; and what a session does when the newest version differs from
the local image's (root `AGENTS.md` and the PM skill: the full checks are run on `main` when the pinned version
changes).

## Evidence

`.pm/archive/402/decisions.md`, PM item of 2026-11-18 09:50. Logs kept in
`.pm/archive/critique-snapshots/402-whole-check-evidence/`: `whole-402.log` (not passed, the one check),
`whole-402-2.log` (passed against 1.0.498), `last.json`.

## Steps to Reproduce

With a local image `aws-emulator` older than the newest package: `docker builder prune` of the layers of
`infra/aws-emulator` (or wait until the cache drops them), then `pm-check` of a checkout whose changes call for
`engine.product-start-has-one-unpublished-emulator`.

## Expected

The emulator the run pins and the emulator the product start runs are one version by construction, whatever
Docker's build cache holds, and a new emulator version arrives by a step someone takes, not by a cache miss.

## Out of scope
