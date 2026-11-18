Issue-Id: 469
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|unit|fifty-tags-cases-time-out-on-the-runner
Issue-Check-Ids: studio-unit:src/providers/aws/area/services/s3/components/bucket-tags.test.tsx studio-unit:src/providers/aws/area/services/iam/components/role-tags.test.tsx studio-unit:src/test/case-bounds.test.ts
Issue-Commit: d0b7b289ae4b0fb49d6caaee89585c76f72641ff

# Keep the two unit cases that fill fifty tags within their time on the GitHub Actions runner

> Identified against commit `d0b7b289ae4b0fb49d6caaee89585c76f72641ff`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main` at `d0b7b28` (the push that carries issue 256) failed in `studio-unit`, in both runs of the
step, on two unit cases that fill a form with fifty tags:

- `src/providers/aws/area/services/s3/pages/create-bucket-page.test.tsx`: '"Add tag" → "Key", "Value" and
  "Remove"; "Remove" → gone; with 50 tags "Add tag" is disabled with the reason' (issue 256): 8924 ms against a
  bound of 5000 ms.
- `src/providers/aws/area/services/iam/pages/create-role-page.test.tsx`: 'a 51st tag cannot be added' (issue
  82): 63189 ms against its own bound of 60000 ms.

2529 of 2531 cases passed. The integration step passed (1168 s). The IAM case passed in the run of `f79f7f0`
the day before, when the step took 100 s; with issue 256's unit cases the step takes 168 s on the runner (four
cores), and both cases build their fifty rows one click at a time in jsdom. On the owner's machine both pass
(issue 256's whole check, `studio-unit` 28 s).

The services selected by the run's step `services`: every service (a shared path changed).

What the requirement has to settle: how such a case reaches fifty rows without fifty rounds of user events
(the form opened with the rows already there, or the rule asserted on the component that holds it), what the
case still proves about the fiftieth and fifty-first row, and whether a bound of 60 s on a unit case is ever
right. Issues 20, 66 and 466 are about unit cases that time out when the machine is busy; this one is two cases
that are slow by what they do, on a slower machine.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44137497388 ; failed steps' log `.pm/run/ci-d0b7b28.log` in the
main checkout (lines 30 to 37 and 253 to 283).

## Steps to Reproduce

1. Push `main` at `d0b7b28`; read the workflow's `studio-unit` and its second run.

## Expected

- Both cases pass on the runner well inside the default bound, and still prove what they prove.
- No unit case of Studio has a bound above the default without a recorded reason.

## Out of scope

- The cases that time out only under load on the owner's machine (issues 20, 66, 466).
