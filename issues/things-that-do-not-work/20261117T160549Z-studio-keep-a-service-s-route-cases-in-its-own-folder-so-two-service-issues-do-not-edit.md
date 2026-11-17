Issue-Id: 468
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|routes-test|every-service-in-one-file
Issue-Check-Ids:
Issue-Commit: f79f7f0518ff4edab1e15c11d85ce2cebc9184f4

# Keep a service's route cases in its own folder so two service issues do not edit one routes test

> Identified against commit `f79f7f0518ff4edab1e15c11d85ce2cebc9184f4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

`studio/src/app/routes.test.tsx` holds the route cases of every service in one file: the hand-written list
`WITH_SCREEN` of the services whose route has a screen of its own, the case that counts the services without one,
and each service's own cases (which path opens which screen, which path below it is still the "no screen yet"
page). Every service issue adds its service's label to the list and its cases to the file, so two service issues
built in parallel edit the same lines, and bringing `main` into the second one's branch conflicts there.

Issue 386 made a service register its screens inside its own folder
(`studio/src/providers/aws/area/services/<service>/`), and the test already reads the services' labels and paths
from those folders (`serviceLinks()` of `studio/src/test/service-files.ts`). The list of services with a screen and
each service's route cases are what is left in the shared file.

The reference is Studio's own stated behavior: the cases assert the same routes as today; only where they are
written changes.

## Evidence

- `studio/src/app/routes.test.tsx` on `main` at `f79f7f0`: `WITH_SCREEN` at lines 21 to 29 (three labels written
  out); IAM's cases from line 201, S3's from 267, Lambda's from 285; 406 lines.
- `git log --oneline main -- studio/src/app/routes.test.tsx`: `b447931` (issue 82, `s4`) and `9f7e607` (issue 84,
  `s4`) both edit it, and `b25784c` is the merge of `main` into `feat/82-s4` that had to resolve it.
- `git diff --stat main...feat/256 -- studio/src/app/routes.test.tsx` (at `3fd23ac`): 134 insertions, 1 deletion,
  the third service issue in a row to edit the file.
- `.pm/issue-402/decisions.md`, PM decisions: bringing `main` into the second and third service's issue branch
  conflicted both times in this file and in the checks' manifest; each cost a reopened worker and a review of the
  merge (decisions of issues 82 and 256, 2026-11-17 23:35 and 2026-11-18 00:30).
- `studio/src/test/service-files.ts`, `readServiceFolders` and `serviceLinks`: the folders are already read by the
  test's support.

## Steps to Reproduce

1. On two branches cut from the same commit of `main`, give two different services without a screen a first
   screen, each with its route cases, as issues 82 and 84 did.
2. Merge one into `main`, then `main` into the other.
3. `studio/src/app/routes.test.tsx` conflicts at `WITH_SCREEN` and where the cases were added.

## Expected

- The services whose route has a screen are read from the services' folders (a folder that registers screens),
  not written out in a test; the case that counts the services without a screen still fails when a service's
  folder and its route disagree.
- A service's route cases are in a test file inside `studio/src/providers/aws/area/services/<service>/`, and
  render the same `routes` as the shared file does.
- `studio/src/app/routes.test.tsx` holds only the cases that are of no one service; a branch that gives one
  service a screen changes no line of it.
- Every route case that passes today passes unchanged in what it asserts.

## Out of scope

- The checks' side: a service's check support and manifest rows (issue 402).
- The number of services written out in tests (issue 417).
- Which routes a service has.
