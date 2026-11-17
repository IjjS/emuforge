Issue-Id: 471
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: gap
Issue-Source: worker
Issue-Key: harness|check-comments|old-support-paths
Issue-Check-Ids:
Issue-Commit: ca5dd1ecf6a004a09c33ba21479cf962ec114aa1

# Point the check files' header comments at the service folders their support moved to

> Identified against commit `ca5dd1ecf6a004a09c33ba21479cf962ec114aa1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 402 moved the support files of S3, Lambda and IAM from `tests/integration/studio/support/` to
`tests/integration/studio/services/<service>/` under their names. In the check files only import lines could change
(decisions of issue 402, 2 and 7), so the header comments of 33 check files still name the old places
(`support/s3.ts`, `support/iam.ts`, `support/lambda-list.ts`, …), and so does the head comment of
`support/screen-rules.ts` (`checkPrefix` of `support/s3.ts`; it is now in `support/service-screens.ts`). A reader
who follows such a comment finds no file there.

## Evidence

At `ca5dd1e` (branch `feat/402-h2`):

```
git grep -n "support/\(s3\|iam\|lambda\)[-a-z]*\.ts" -- 'tests/integration/studio/*.spec.ts' tests/integration/studio/support/
```

prints 37 lines, e.g. `s3-bucket-page.spec.ts:11: ... direct calls and `Seeded`: `support/s3.ts`.`,
`iam-role-list.spec.ts:13: `support/iam.ts`, ...`, `support/screen-rules.ts:6: ... `checkPrefix` of `support/s3.ts` ...`;
none of those files exists.

## Steps to Reproduce

Run the `git grep` above on a checkout that holds issue 402.

## Expected

Each comment names the file where the helper now lives: `services/<service>/<file>.ts`, or
`support/service-screens.ts` for the seven shared names. Only comments change; no import, assertion or row.

## Out of scope

The imports themselves (issue 402), and comments that name a file that still exists.
