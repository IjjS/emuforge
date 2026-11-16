Issue-Id: 53
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|ci|check-main-on-github-actions
Issue-Check-Ids: harness.integration-not-run harness.ci harness.ci-docs
Issue-Commit: 8e35c04f7dc15af29485f083fb0efb6221624d69

# Check main on GitHub Actions at each push instead of on the owner's machine

> Identified against commit `8e35c04f7dc15af29485f083fb0efb6221624d69`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Every time an issue is finished the `pm` runs the full check suite on `main` in the main checkout before it
pushes: 17.5 minutes on the owner's machine (integration about 12 minutes, the harness's own tests about 5.5),
during which nothing else can be merged, and the result depends on that one machine's state (leftover folders,
other runs' containers, load). The run almost always repeats a check a branch has just passed.

The owner wants that check to be the tests GitHub Actions runs when `main` is pushed, on an Ubuntu runner, and
nothing more locally at a merge or a push: the harness's own tests run only when the harness changes (issue
#52).

Order: after issue #52, which makes `pm-merge` ask that a branch held current `main` when its check passed;
without that a push could publish a combination nobody checked.

Reference: none; the harness's own behavior.

## Evidence

- `.github/` holds `ISSUE_TEMPLATE` only; the repository has no workflow. `gh repo view` reports the repository
  as public.
- `output/checks/last.json` of `main` at `fcb3089`: `integration` 702.5 s, `harness-test` 328.9 s, the other
  eight steps 19.4 s together.
- The PM skill, flow steps 5 and 6: "When every unit is in: `pm-check .` on `main`. It must pass." and "with ...
  the last `pm-check .` a pass on this commit, `git push origin main`".
- What does not run on Ubuntu as it is: the sixteen `engine.product-*` checks (issue #34) reach the emulator
  through `host.docker.internal`, which Docker Desktop provides and Docker Engine on Linux does not by itself
  (`infra/emuforge/haproxy.cfg:59`); some harness tests use macOS tools (`.pm/bin/tests/_hang.py`,
  `.pm/bin/_pmlib.py`).

## Steps to Reproduce

1. Finish an issue: the `pm` waits for `pm-check .` on `main` before `git push origin main`.
2. Look at GitHub after the push: nothing ran.

## Expected

- A workflow runs on every push to `main`, on an Ubuntu runner: the engine steps, the Studio steps and the
  integration checks, the same commands `pm-check` runs, against an emulator started on the runner. It needs no
  secret, uses no AWS account, and sends nothing to real AWS.
- The checks that cannot run on Ubuntu yet are named in one place with the reason and are reported by the
  workflow as not run, never as passed: the product-form checks until the product form supports Docker Engine
  on Linux (its own issue), and the harness's own tests.
- The `pm` no longer runs `pm-check .` on `main` at a merge or before a push. After a push it reads the
  workflow's result for that commit (`gh run`), and a failed run becomes an issue file with the run's log as
  evidence, ahead of other work. The PM skill and root `AGENTS.md` say so; the sentences are the owner's to
  approve.
- A way to try the workflow before it gates anything, since it only runs on GitHub: the plan says how, within
  the rule that only `main` is pushed, or names the exception it asks the owner for.
- The README's Develop part says that `main` is checked on GitHub Actions and shows the result.

## Out of scope

- Building or publishing images and releases: issue #35 (it can share this workflow file later).
- Which steps a branch runs locally before its merge: issue #52.
- Making the product form run on Docker Engine on Linux.
