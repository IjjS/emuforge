Issue-Id: 454
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|table-and-vector-buckets
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build the S3 "Table buckets" and "Vector buckets" screens

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's S3 navigation has the entries "Table buckets" and "Vector buckets"; Studio's S3 navigation (issue 56) has "General purpose buckets" and "Directory buckets" only. The emulator holds both kinds; they are services of their own (`s3tables`, `s3vectors`), so Studio needs a client for each, which this issue's requirement settles with the area's rules.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ s3tables CreateTableBucket (issue 56)   -> ok, then listed by ListTableBuckets
$ s3vectors CreateVectorBucket (issue 56)   -> ok, then listed by ListVectorBuckets
Not called: namespaces and tables of a table bucket, indexes and vectors of a vector bucket, the deletes.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a table bucket with the AWS CLI.
2. Open `/aws/s3/buckets`.
3. The navigation has no entry "Table buckets" or "Vector buckets", and no screen shows the bucket.

## Expected
- The navigation has both entries; each leads to a list of what the emulator holds; a bucket of each kind can be created, opened and deleted; the emulator's answer is shown.
- The requirement states by calling what the emulator holds below each (namespaces and tables; indexes), and a part it answers 501 for is shown as "not implemented".
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Querying a table. Putting and querying vectors unless the requirement takes them up. Any engine change. Anything sent to real AWS.
