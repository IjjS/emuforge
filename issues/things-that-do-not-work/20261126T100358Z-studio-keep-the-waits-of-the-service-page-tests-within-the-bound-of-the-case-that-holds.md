Issue-Id: 661
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|service-test-waits|wait-outlasts-case-bound
Issue-Check-Ids:
Issue-Commit: e4bf28ba66357773bb11bc6ea39f2c829fcbbbe5

# Keep the waits of the service page tests within the bound of the case that holds them

> Identified against commit `e4bf28ba66357773bb11bc6ea39f2c829fcbbbe5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Six unit-test files of the AWS area's services give a wait (`findBy…`, `waitFor`) 10 000 ms inside cases that run
under Vitest's default bound of 5000 ms: none of the six holds a case bound above the default (the scan of
`studio/src/test/case-bounds.ts` finds no raised bound in them). A case under the default bound ends before such a
wait does, so when what it waits for does not come, the case reports "Test timed out in 5000ms" instead of what it
did not find, and the wait's own number says nothing true about how long the case allows. Issue 466 removed the same
mismatch from the eight files that load the AWS area and added a rule to the scan for it, applied to those eight
files only. The reference is those files after issue 466: no wait above the bound of the case that holds it.

## Evidence

At `e4bf28ba`, under `studio/src/providers/aws/area/services/`, each line a wait given `timeout: 10_000`:

- `s3/pages/create-bucket-page.test.tsx:230`
- `s3/pages/delete-bucket-page.test.tsx:300`, `:397`, `:411`
- `s3/pages/empty-bucket-page.test.tsx:349`, `:442`
- `iam/pages/create-policy-page.test.tsx:105`
- `iam/pages/policy-list-page.test.tsx:221`
- `iam/pages/policy-page.test.tsx:241`, `:472`, `:486`, `:495`, `:528`

`grep -rc "// Bound:"` on those six files gives 0 for each, and `studio/src/test/case-bounds.test.ts` ('every test
file under studio/src/ as it is on the branch → no finding') passes, so none of their cases has a bound above 5000 ms.

Two more waits above 5000 ms are in files that do hold raised bounds, and were not traced to their cases:
`iam/components/attach-policies-dialog.test.tsx:435` (8000 ms) and `rds/pages/cluster-page.test.tsx:1212` (6000 ms).

## Steps to Reproduce

1. In `studio/`, apply the wait rule of `src/test/case-bounds.ts` (issue 466) to the six files above instead of the
   eight it reads.
2. It names the thirteen waits listed.

## Expected

- No wait in a unit-test file under `studio/src/providers/aws/area/services/` is given a time above the bound of a
  case that holds it; the two untraced waits are traced and brought under the same rule.
- The wait rule of the scan of case bounds reads every test file under `studio/src/`, not eight.
- What the cases assert is unchanged.

## Out of scope

Why a service page's first render was given 10 000 ms (if it is slow under load, that is measured and fixed where it
is, as issue 466 did for the area's load), and Vitest's default bound.
