Issue-Id: 447
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-properties-edit
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build S3 task 10: change a bucket's tags, default encryption, static website hosting and lifecycle rules

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

> Narrowed by issue 480 (`.pm/issue-480/decisions.md`, PM, 2026-11-18): this is task 10 of S3's task list
> (`.pm/archive/480/requirement.md` once archived): read and change a bucket's tags, default encryption, website and
> lifecycle rules. Versioning's edit is task 8's and event notifications are task 6's (later issues); ABAC,
> Intelligent-Tiering, server access logging, EventBridge, transfer acceleration, Object Lock and Requester pays are
> no longer a task, and their sections left the bucket's Properties in issue 480. The lifecycle rules of issue 449
> are folded in here.

## Description
A bucket's Properties tab (issues 256, 480) shows tags, default encryption and static website hosting read-only;
each section's "Edit" leads to a route below `/aws/s3/bucket/<name>/property/` that shows the area's "no screen yet"
page, and lifecycle rules are not shown at all. A developer sets these locally to match what an app or an IaC
template expects. Built by the method of `studio/references/workflow.md`: the tasks as far as the emulator's API
supports them, the calls through the engine, the states `studio/AGENTS.md` names.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api put-bucket-versioning --versioning-configuration Status=Enabled / Status=Suspended   -> ok, read back; MFADelete=Enabled -> IllegalVersioningConfigurationException; Suspended while Object Lock is on -> InvalidBucketState
$ aws s3api put-bucket-tagging   -> ok, read back, an empty value kept; a key starting `aws:` -> InvalidTag "System tags cannot be added/updated by requester"; a duplicate key, a key over 128 or a value over 256 characters -> InvalidTag; 51 tags -> BadRequest "Bucket tags cannot be greater than 50"; an empty TagSet -> no tag set
$ aws s3api put-bucket-encryption (aws:kms with a key ARN and BucketKeyEnabled true; aws:kms:dsse)   -> ok, read back; an unknown algorithm -> MalformedXML; a key id that is no key -> ok (put-object then fails with KMS.NotFoundException); delete-bucket-encryption -> AES256 again
$ aws s3api put-bucket-intelligent-tiering-configuration --id tier1   -> ok, listed
$ aws s3api put-bucket-logging (TargetBucket, TargetPrefix)   -> ok, read back
$ aws s3api put-bucket-notification-configuration (EventBridgeConfiguration)   -> ok; (a queue whose policy allows s3.amazonaws.com) -> ok; (a queue without it) -> InvalidArgument "Unable to validate the following destination configurations"
$ aws s3api put-bucket-accelerate-configuration Status=Enabled / put-bucket-request-payment Payer=Requester / put-bucket-website (index, error) / put-bucket-abac Status=Enabled   -> ok, each read back
$ aws s3api put-object-lock-configuration (default retention GOVERNANCE, 1 day)   -> ok on a bucket with versioning Enabled; without -> InvalidBucketState
Not called: redirection rules of a website, a notification to SNS or Lambda, a tiering configuration with a filter.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. In the section "Bucket Versioning" choose "Edit".
4. The page says there is no screen yet.

## Expected
- Tags, default encryption and the website configuration can each be changed from the bucket's Properties and are
  read back as the emulator holds them; the emulator's refusal is shown as it came.
- Lifecycle rules are listed, created, edited and deleted; the requirement finds out by calling whether the emulator
  acts on a rule (expires an object) and the screen says only what it was seen to do.
- A rule the emulator was seen to enforce (the tag rules above) is told before the request; a KMS key that does not
  exist is accepted by the emulator, and the screen says in EmuForge's own words that objects cannot then be put.
- Each task is proven by a business scenario against the real emulator; the screens are critiqued once on the
  built app (`studio/references/critique.md`).

## Out of scope
Versioning (task 8), event notifications (task 6), the sections no longer a task (above), choosing a KMS key from a
list. Any engine change. Anything sent to real AWS.
