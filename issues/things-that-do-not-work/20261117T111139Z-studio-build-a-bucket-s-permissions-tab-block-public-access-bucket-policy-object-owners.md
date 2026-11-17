Issue-Id: 448
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-permissions
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build a bucket's "Permissions" tab: Block public access, bucket policy, Object Ownership, ACL, CORS

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A bucket's tab "Permissions" (issue 256) leads to `/aws/s3/buckets/<name>/permissions`, which shows the area's "no screen yet" page; "Create bucket" sets Object Ownership and Block Public Access, and nothing shows them afterwards. The emulator holds each of the tab's settings.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api get-public-access-block (a fresh bucket)   -> ok, all four true
$ aws s3api put-public-access-block (all true / all false)   -> ok, read back; delete-public-access-block -> ok, then NoSuchPublicAccessBlockConfiguration
$ aws s3api get-bucket-policy (a fresh bucket)   -> NoSuchBucketPolicy
$ aws s3api put-bucket-policy (Principal * while the block is on)   -> AccessDenied "... because public policies are prevented by the BlockPublicPolicy setting in S3 Block Public Access ..."
$ aws s3api get-bucket-policy-status (a bucket without a policy)   -> NoSuchBucketPolicy "The bucket policy does not exist"
$ aws s3api get-bucket-ownership-controls   -> ok, BucketOwnerEnforced; put-bucket-ownership-controls BucketOwnerPreferred -> ok, read back
$ aws s3api get-bucket-acl   -> ok, the owner with FULL_CONTROL
$ aws s3api get-bucket-cors   -> NoSuchCORSConfiguration
$ aws s3api create-bucket --acl public-read (default ownership)   -> InvalidBucketAclWithObjectOwnership
Not called: put-bucket-policy with a policy that is not public, put-bucket-acl, put-bucket-cors, delete-bucket-policy.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. Choose the tab "Permissions".
4. The page says there is no screen yet.

## Expected
- The tab shows the bucket's Block public access settings, policy, Object Ownership, ACL and CORS configuration as the emulator holds them, "not set" in EmuForge's own words where it holds none, and each can be edited; the emulator's refusal is shown as it came.
- The screen says that the emulator stores the policy; whether anything evaluates it is for the requirement to find out by calling.
- A change of Block public access asks for the confirmation the console asks for.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
IAM evaluation by the engine. The External access summary panel (issue 58). Access Points. Any engine change. Anything sent to real AWS.
