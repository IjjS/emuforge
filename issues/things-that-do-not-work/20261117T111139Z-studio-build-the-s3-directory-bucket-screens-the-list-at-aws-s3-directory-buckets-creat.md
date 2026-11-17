Issue-Id: 453
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|directory-buckets
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build the S3 directory bucket screens: the list at `/aws/s3/directory-buckets`, create and delete

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The bucket list's tab "Directory buckets" (issue 56) leads to `/aws/s3/directory-buckets`, which shows the area's "no screen yet" page. The emulator holds directory buckets.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ PUT /probe56--use1-az4--x-s3 with a directory bucket configuration (issue 56)   -> ok
$ ListDirectoryBuckets (issue 56)   -> ok, the bucket listed
$ aws s3api create-bucket --bucket p256--x-s3 (no configuration)   -> NoSuchBucket from CreateSession (the AWS CLI treats the name as a directory bucket's)
$ aws s3api create-bucket --bucket p256--table-s3 / p256--ol-s3 / p256-s3alias   -> InvalidBucketName
Not called while planning issue 256: reads of a directory bucket's properties, objects in one, DeleteBucket of one, CreateSession with a bucket that exists.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a directory bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the tab "Directory buckets".
3. The page says there is no screen yet.

## Expected
- The emulator's directory buckets are listed with what `ListDirectoryBuckets` returns, page by page; one can be created (the name's form told before the request) and deleted with the confirmation the console asks for; the emulator's answer is shown.
- The requirement states by calling which of a general purpose bucket's operations a directory bucket answers through the engine, CreateSession included, and the engine is not changed here: what needs an engine change is filed for the engine.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
A directory bucket's objects and properties unless the requirement takes them up. Access points for directory buckets. Any engine change. Anything sent to real AWS.
