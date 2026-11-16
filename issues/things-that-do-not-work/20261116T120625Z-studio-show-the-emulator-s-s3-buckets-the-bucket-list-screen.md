Issue-Id: 56
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|s3|bucket-list
Issue-Check-Ids:
Issue-Commit: 12978b702e88db1ab72091b0c578094467eb8c53

# Show the emulator's S3 buckets: the bucket list screen

> Identified against commit `12978b702e88db1ab72091b0c578094467eb8c53`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio has no screen for any AWS service. Every service in the AWS area says "no screen yet". The first screen
is the S3 bucket list, at `/aws/s3` (and `/aws/s3/buckets`): the buckets the emulator holds, whoever made them,
with the list's own actions.

It is the first screen built to the AWS screen policy (`studio/AGENTS.md`), and the owner chose that policy on
a sample of this very screen. So it settles in code what later screens copy: how a `console` screen is laid
out in the area, how it names its resources for the local-emulator notice, how loading, empty, unreachable and
"not implemented by the emulator" look, and how a reference spec with `omitted` parts is written and scored.

Scope: the list only. Each row's name leads to the bucket's page, which does not exist yet; "Create bucket",
"Empty", "Delete" and "Copy ARN" are on the screen as the console has them, and what each does when its own
screen or dialog does not exist yet is for the requirement to say (the policy keeps an action the emulator
answers 501 for; an action whose screen is not built is a different case).

Reference: the AWS console's "General purpose buckets" screen, for structure and vocabulary: the owner's
captures under `docs/aws-console/s3/` in the main checkout (outside git; `02-general-purpose-buckets.png` and
its neighbours) and the AWS user guide. The owner's sample and its two reviews are in `.pm/policy-sample/` and
`.initial-refs/policy/` there.

## Evidence

```
$ grep -n "s3" studio/src/providers/aws/services.ts | head -3
```

lists S3 among the services, and `/aws/s3` renders the area's "no screen yet" page (flow check
`studio.service-routes-say-no-screen-yet`). `studio/references/console/` does not exist: no reference spec has
been written yet.

## Steps to Reproduce

1. Start EmuForge, create a bucket in the emulator with any tool, open `/aws/s3`.
2. The page says there is no screen yet; the bucket is not shown.

## Expected

- `/aws/s3` shows the emulator's buckets in a Cloudscape table that follows the console's bucket list in
  structure and vocabulary, with only the parts the emulator has; each part left out is recorded in the
  screen's reference spec under `omitted` with its evidence.
- Buckets made outside Studio appear; the list is read from the emulator through the engine each time it opens
  or is refreshed, never from a browser cache.
- Loading, empty, the emulator not reachable, and an operation the emulator answers 501 for each have their own
  state in EmuForge's own words, in Cloudscape's patterns for them.
- The local-emulator notice names this screen's resources and can be closed and brought back with its (i)
  control; the breadcrumbs read `EmuForge > AWS > S3 > Buckets`.
- The screen passes the structure score against its reference spec and the critique, seeded and empty.
- Integration checks run every state against a real emulator, and compare what the screen shows with what the
  emulator answers directly.
- Nothing is sent to real AWS; no key reaches the browser.

## Out of scope

- The bucket's own page, its objects, and the create, empty and delete flows: each is its own issue.
- Directory, table and vector buckets, and every other entry of the console's S3 navigation.
- Any other service.
