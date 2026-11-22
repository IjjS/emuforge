Issue-Id: 499
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|object-copy-rename
Issue-Check-Ids: studio.s3-copy-object-to-another-bucket studio.s3-rename-object-to-another-key studio.s3-edit-object-properties-in-place studio.s3-copy-object-bucket-limit studio.s3-edit-object-after-source-removed
Issue-Commit: 5dca87cc1f4351f4e61bff199ef41f16ef2210ef

# Build S3 task 7: copy, rename or retype an object

> Identified against commit `5dca87cc1f4351f4e61bff199ef41f16ef2210ef`. The code may have drifted since; trace the issue to the current code before fixing.

> Filed by issue 480 (`.pm/issue-480/decisions.md`, PM, 2026-11-18): task 7 of S3's task list
> (`.pm/archive/480/requirement.md` once archived), a later issue in the order 6 to 10.

## Description
A developer copies an object to another key or bucket, renames it, or changes its content type or metadata in
place, to set up test data. Studio's object page (issue 480) shows an object's properties and downloads it, but
offers no copy, rename or change of type or metadata. Built by the method of `studio/references/workflow.md`.

## Evidence
Called on 2026-11-18 while planning issue 480, own emulator on port 9480 (image `aws-emulator` `0414f7370a0f`), the
AWS CLI with the keys it wrote, straight to the emulator (not through the engine's relay); no call answered 501:

```
$ aws s3api copy-object (to another key and to another bucket)   -> ok, the copy listed and read back
$ aws s3api copy-object --metadata-directive REPLACE (same key, a new content type and metadata)   -> ok, head-object shows the new values
$ aws s3api delete-object   -> ok (a rename is a copy then a delete)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a bucket and put an object with the AWS CLI.
2. Open the bucket's Objects tab and choose the object.
3. The object page offers no copy, rename or edit of type or metadata.

## Expected
- An object is copied to another key or bucket, renamed (the copy made, the original deleted, the user told if the
  delete fails after the copy) and given a new content type or metadata in place; each is read back as the
  emulator holds it.
- The emulator's refusal (a bucket at its 1000-object or 64 MiB limit, a key that is gone) is shown as it came.
- Each is proven by a business scenario against the real emulator.

## Out of scope
Versions (task 8), presigned URLs, S3 Select, restore, editing an object's tags beyond what copy carries.
