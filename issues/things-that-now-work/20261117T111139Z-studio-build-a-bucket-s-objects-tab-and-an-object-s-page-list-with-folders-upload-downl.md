Issue-Id: 446
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|objects
Issue-Check-Ids: studio.s3-objects-show-what-an-app-wrote,studio.s3-objects-page-through-the-emulator-answer,studio.s3-objects-of-a-bucket-that-is-gone,studio.s3-objects-follow-emulator-restart,studio.s3-object-page-shows-what-the-object-holds,studio.s3-object-page-of-an-object-that-is-gone,studio.s3-object-page-follows-emulator-restart,studio.s3-upload-puts-files-in-a-folder,studio.s3-upload-shows-the-emulator-refusal,studio.s3-upload-in-parts-aborts-on-refusal,studio.s3-create-folder,studio.s3-delete-objects-and-folders,studio.s3-delete-in-a-versioned-bucket-keeps-versions,studio.s3-delete-says-when-the-bucket-is-gone
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build a bucket's "Objects" tab and an object's page: list with folders, upload, download, delete, create folder

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A bucket's page (issue 256) shows the bucket's properties at `/aws/s3/buckets/<name>`, and its tab "Objects" leads to `/aws/s3/buckets/<name>/objects`, which shows the area's "no screen yet" page: Studio shows nothing of what a bucket holds. The console opens a bucket on its "Objects" tab, so this issue takes the bucket's bare route from the properties, which stay at `/aws/s3/buckets/<name>/properties` (issue 256, question 1). The emulator keeps objects, versions and delete markers.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api put-object --bucket p256-del --key a.txt --body a.txt   -> ok, ETag, ChecksumCRC64NVME, ServerSideEncryption AES256
$ aws s3api list-objects-v2 --bucket p256-re   -> ok, the keys put
$ aws s3api delete-object --bucket p256-delv --key a.txt (versioning Enabled)   -> ok, DeleteMarker true and a VersionId; list-objects-v2 then returns no key, list-object-versions the version and the delete marker
$ aws s3api list-object-versions --bucket p256-e1 --max-keys 3   -> ok, IsTruncated true with NextKeyMarker and NextVersionIdMarker
$ aws s3api delete-objects (a key without VersionId in a versioned bucket)   -> ok, a delete marker is made; (an unknown version) -> a per-key Error NoSuchVersion; (a version under legal hold) -> a per-key Error AccessDenied "Access Denied because object protected by object lock."
$ put-object of keys with a space, Hangul, `&<>`, `//`, `?#%`   -> ok, listed and deleted under the same keys
$ aws s3api put-object (the 1001st object or version of a bucket)   -> ValidationException "the bucket ... already holds the maximum of 1000 objects this emulator keeps per bucket"
$ aws s3api put-object into a bucket whose default encryption names a KMS key that does not exist   -> KMS.NotFoundException "Key '...' does not exist"
$ aws s3api create-multipart-upload --bucket p256-delm --key big.bin / list-multipart-uploads   -> ok / ok, the upload listed
Not called: get-object, head-object, copy-object, the object's tags, ACL, legal hold and retention reads, a listing with a delimiter.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. The page shows the bucket's properties; choose the tab "Objects".
4. The page says there is no screen yet.

## Expected
- `/aws/s3/buckets/<name>` opens the bucket on "Objects": the objects and folders of a prefix are listed by asking the emulator page by page, never by loading every key; a folder opens its prefix.
- An object can be uploaded, downloaded and deleted, and a folder created; an object's page shows its properties; the emulator's answer, a refusal included (the 1000 limit, a KMS key that does not exist, Object Lock), is shown as it came.
- With "Show versions" the versions and delete markers are listed, and a delete names the version.
- A key is shown as text whatever characters it holds, and an object's content is never stored or logged by Studio.
- The properties stay at `/aws/s3/buckets/<name>/properties`, and the cases and checks of issue 256 that open the bare route are changed by this issue's `t` unit.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Multipart uploads' own list. Batch operations. S3 Select. Presigned addresses shared outside Studio. The "Empty" and "Delete" pages (issue 256). Any engine change. Anything sent to real AWS.
