Issue-Id: 452
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3.create-bucket|copy-settings-kms-key-chooser
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Add to "Create bucket": "Copy settings from existing bucket" and choosing a KMS key from the emulator's keys

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Create bucket" (issue 256) has no "Copy settings from existing bucket", the one item of the reference spec `studio/references/console/s3/create-bucket.yaml` that issue 256 leaves unbuilt, and under "AWS KMS key" it takes the key as a typed ARN only: the console's "Choose from your AWS KMS keys" needs KMS's client, which Studio does not have yet. The emulator answers every read the copy needs and lists its KMS keys.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api get-bucket-versioning / get-bucket-tagging / get-bucket-encryption / get-public-access-block / get-bucket-ownership-controls / get-object-lock-configuration   -> each answered for a bucket with the setting and for one without (the codes are in `probe-1.log`, section 1)
$ aws kms list-keys (a fresh emulator)   -> ok, empty
$ aws s3api put-object into a bucket with default encryption aws:kms and no key id   -> ok (the emulator makes a key itself)
$ aws s3api put-bucket-encryption with a key ARN that is no key   -> ok; put-object then -> KMS.NotFoundException "Key '...' does not exist"
Not called: kms create-key and describe-key through the engine.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a KMS key and a bucket with the AWS CLI.
2. Open `/aws/s3/bucket/create`.
3. There is no "Copy settings from existing bucket"; with SSE-KMS chosen the key can only be typed.

## Expected
- "Choose bucket" opens the emulator's buckets, and choosing one fills the form with that bucket's settings as the emulator holds them; "Restore defaults" returns the form to its start; the spec's item matches (37/37).
- Under "AWS KMS key" the emulator's keys can be chosen from a list read through the engine, and an ARN can still be typed; a typed ARN that is no key of the emulator is told before the bucket is created.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
"Create a KMS key" from the form (the KMS screens' issue). Any other change of the form. Any engine change. Anything sent to real AWS.
