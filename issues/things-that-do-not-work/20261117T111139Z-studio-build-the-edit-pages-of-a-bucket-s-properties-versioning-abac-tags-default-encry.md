Issue-Id: 447
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-properties-edit
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build the edit pages of a bucket's properties: versioning, ABAC, tags, default encryption, Intelligent-Tiering, logging, event notifications, EventBridge, acceleration, Object Lock, Requester pays, website hosting

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A bucket's page (issue 256) shows each property read-only; each section's "Edit" or "Create" button leads to a route below `/aws/s3/bucket/<name>/property/` that shows the area's "no screen yet" page. The emulator stores every one of these properties and reads it back.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

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
- Each section's button opens a page that shows the property as the emulator holds it and sends its change; the bucket's page then shows what the emulator holds; the emulator's refusal is shown as it came.
- The messages for input the emulator would refuse (the tag rules above, Object Lock without versioning) are told before the request where the rule is known, and the emulator's refusal is shown where it is not.
- A KMS key that does not exist is accepted by the emulator: the page says in EmuForge's own words that objects cannot then be put.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The "Permissions", "Management", "Metrics" and "Metadata" tabs. The section "AWS CloudTrail data events". Choosing a KMS key from a list (the "Create bucket" issue filed beside this). Any engine change. Anything sent to real AWS.
