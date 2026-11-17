Issue-Id: 293
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: plan
Issue-Key: harness|integration-run|unbounded-image-build
Issue-Check-Ids:
Issue-Commit: af97792e05500143d002b02804cb9acab9fa882e

# Bound the image builds of the integration run so a build that hangs cannot hold a check slot

> Identified against commit `af97792e05500143d002b02804cb9acab9fa882e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`tests/integration/run` builds the product image with `docker compose --progress plain build` and gives the build
no bound. When Docker's builder cannot reach a registry it does not fail: it stays at
`[internal] load metadata for <base image>` for as long as it is left. The run then never ends, `pm-check` never
returns, and the run keeps its check slot (`.pm/run/check-slots/`, two for the machine), so two such runs stop
every other worktree's check without a line saying so. `pm-check` has no bound of its own for a step either.

The reference is the suite's own rule (`tests/integration/AGENTS.md`, Verdicts): the environment failing is an
`error`, reported, and the run is not used as evidence. A build that cannot finish is that case and must end as
one, within a stated time.

## Evidence

On 2026-11-17 07:44 KST, on this machine, two integration runs started by `pm-check` (worktrees `emuforge-54-t1`
and `emuforge-56-t2`) had been in their product image build for about six hours, and a worker's own build of the
emulator image for as long (`.pm/issue-68/probe/hung-builds.txt`):

```
 6370  5586 06:05:34 bash ./run
 6508  6507 06:05:31 docker compose --progress plain build
24788 23685 05:58:29 bash ./run
24964 24963 05:58:26 docker compose --progress plain build
 7879  7878 06:04:34 docker compose -f infra/aws-emulator/docker-compose.yml --progress plain build
```

At the same time a build of two lines, bounded by hand at 60 seconds, stopped at the same place, while a build
that names no base image finished in 0.3 seconds (`.pm/issue-68/probe/build1.log`, `build2.log`, `build3.log`):

```
#2 [internal] load metadata for public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
exit timeout after 62.0s
```

## Steps to Reproduce

1. Make Docker's builder unable to reach its registries (the state above; a machine that has slept, or no network).
2. `.pm/bin/pm-check <worktree>` on a worktree whose changes call for `integration`.
3. The run stays in `docker compose --progress plain build`; `output/checks/running.json` names the step
   `integration` for hours and one of the two slot locks stays held.

## Expected

- Every image build the integration run starts ends within a stated bound; past it the build's process group is
  ended and the run reports every check `error` with a reason that names the build and its log (exit 127), as it
  does when Docker does not answer.
- The check slot is free again when the run has ended.
- A harness test shows it with a stand-in `docker` whose `build` does not return.

## Out of scope

- A bound for every step of `pm-check` (a hung `cargo` or `bun` step): its own issue if it is seen.
- Why the builder could not reach a registry on this machine.
- The emulator image's refresh at session start (issue 68), which sets its own bound.
