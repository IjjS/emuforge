Issue-Id: 58
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3.bucket-list|external-access-summary
Issue-Check-Ids:
Issue-Commit: 3fe1072bb359e60a3c71e72169eebb96dd1dc3a9

# Show the External access summary panel on the S3 bucket list

> Identified against commit `3fe1072bb359e60a3c71e72169eebb96dd1dc3a9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The AWS console's "General purpose buckets" screen has a panel "External access summary" beside the table: IAM
Access Analyzer's findings about buckets that allow public access or access from other accounts. Studio's bucket
list (issue #56) does not have it. The emulator produces what the panel shows, so under the AWS screen policy
(`studio/AGENTS.md`, point 4) the panel belongs on the screen and cannot be marked `omitted` in the screen's
reference spec; issue #56 lists it in the spec as a section and leaves it unbuilt, an unmatched item of the
structure score.

Found while planning issue #56. Reference: the console's screen, capture
`docs/aws-console/s3/02-general-purpose-buckets.{png,mhtml}` in the main checkout (outside git), and the AWS user
guide, "Reviewing bucket access using IAM Access Analyzer for S3".

## Evidence

aws-emulator 1.0.364, `.pm/issue-56/probe/probe-5.log` (main checkout, local), script `probe-r2.sh` beside it:

```
$ aws accessanalyzer list-findings --analyzer-arn arn:aws:access-analyzer:us-east-1:000000000000:analyzer/probe56-an3
```

answered 200 with two findings for `arn:aws:s3:::probe56-shared` (one `isPublic: true`, one for account
`111122223333`) after the bucket got a policy granting both, an `ACCOUNT` analyzer was created and
`start-resource-scan` was run. `list-findings-v2`, `get-findings-statistics` and `list-analyzed-resources`
answered 501 `NotImplemented`.

## Steps to Reproduce

1. With issue #56 merged, give a bucket in the emulator a policy that grants another account, create an `ACCOUNT`
   analyzer and scan the bucket.
2. Open `/aws/s3/buckets`: no "External access summary" is shown; `pm-structure` reports the section unmatched.

## Expected

- The bucket list shows the panel "External access summary" with what the emulator's findings say about its
  buckets, in the console's structure and vocabulary, with EmuForge's own description and states.
- With no analyzer, with no finding, and when an operation it needs answers 501, the panel has its own state
  ("not implemented by the emulator" for the 501).
- The requirement says, by calling the emulator, which operations the panel can be built on (`ListFindings`
  answers; the V2 operations answer 501).
- The spec's section matches in the structure score; integration checks compare the panel with what the emulator
  answers directly.

## Out of scope

- The panel "Account snapshot" (the emulator produces no Storage Lens metric; `omitted` in the spec).
- IAM Access Analyzer's own screens.
