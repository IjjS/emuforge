Issue-Id: 448
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-permissions
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build S3 task 9: set a bucket's access for a local app: Block Public Access, bucket policy, CORS

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

> Narrowed by issue 480 (`.pm/issue-480/decisions.md`, PM, 2026-11-18): this is task 9 of S3's task list. Object
> Ownership and the ACL are no longer a task; the tab "Permissions" left the bucket's page in issue 480, so where
> these settings are shown is this issue's design.

## Description
"Create bucket" sets Block Public Access, and nothing shows it afterwards; a bucket's policy and CORS configuration
cannot be seen or set in Studio. A developer sets them locally so an app, or a browser app talking to the local S3,
behaves as it will against AWS. Issue 480 called them on 2026-11-18: Put/Get/DeleteBucketPolicy and
GetBucketPolicyStatus work, a public policy is refused `AccessDenied` while Block Public Access is on and accepted
after DeletePublicAccessBlock; Get/Put/DeletePublicAccessBlock and Put/Get/DeleteBucketCors work. Built by the
method of `studio/references/workflow.md`.

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
2. Open the bucket in Studio.
3. Nothing shows its Block Public Access, policy or CORS configuration, and nothing sets them.

## Expected
- The bucket's Block Public Access settings, policy and CORS configuration are shown as the emulator holds them,
  "not set" in EmuForge's own words where it holds none, and each can be changed and removed; the emulator's refusal
  (a public policy while the block is on) is shown as it came.
- The screen says that the emulator stores the policy; whether anything evaluates it is for the requirement to find
  out by calling.
- Each task is proven by a business scenario against the real emulator; the screens are critiqued once on the built
  app (`studio/references/critique.md`).

## Out of scope
Object Ownership and the ACL (no longer a task). IAM evaluation by the engine. The External access summary panel
(issue 58, closed out). Access Points. Any engine change. Anything sent to real AWS.
