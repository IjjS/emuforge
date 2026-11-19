Issue-Id: 500
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-versions
Issue-Check-Ids:
Issue-Commit: 5dca87cc1f4351f4e61bff199ef41f16ef2210ef

# Build S3 task 8: turn on versioning, list versions and delete markers, get or restore an old one

> Identified against commit `5dca87cc1f4351f4e61bff199ef41f16ef2210ef`. The code may have drifted since; trace the issue to the current code before fixing.

> Filed by issue 480 (`.pm/issue-480/decisions.md`, PM, 2026-11-18): task 8 of S3's task list
> (`.pm/archive/480/requirement.md` once archived), a later issue in the order 6 to 10.

## Description
A developer turns versioning on for a bucket and looks at, gets or restores an older version of an object, or
removes a delete marker, to test an app that relies on versions. Studio shows the bucket's versioning status
read-only in Properties (issues 256, 480); its "Edit" leads to the area's "no screen yet" page, and the Objects tab
has no "Show versions". Built by the method of `studio/references/workflow.md`.

## Evidence
Called on 2026-11-18 while planning issue 480, own emulator on port 9480 (image `aws-emulator` `0414f7370a0f`), the
AWS CLI with the keys it wrote, straight to the emulator (not through the engine's relay); no call answered 501:

```
$ aws s3api put-bucket-versioning --versioning-configuration Status=Enabled / Suspended   -> ok, read back
$ aws s3api list-object-versions   -> versions and delete markers listed
$ aws s3api get-object --version-id <older id>   -> ok, the older body
(issue 256's probe, aws-emulator 1.0.481: MFADelete=Enabled -> IllegalVersioningConfigurationException; Suspended while Object Lock is on -> InvalidBucketState)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets/<bucket>/properties`; in the section "Bucket Versioning" choose "Edit".
3. The page says there is no screen yet; the Objects tab offers no versions.

## Expected
- Versioning is turned on and suspended from the bucket and read back as the emulator holds it.
- The Objects tab lists an object's versions and delete markers; an older version is downloaded or made current
  again, and a delete marker removed.
- The emulator's refusal is shown as it came.
- Each is proven by a business scenario against the real emulator.

## Out of scope
MFA delete, Object Lock (no longer a task), lifecycle rules for noncurrent versions (task 10, issue 447).
