Issue-Id: 450
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-metrics-metadata
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build a bucket's "Metrics" and "Metadata" tabs

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A bucket's tabs "Metrics" and "Metadata" (issue 256) lead to `/aws/s3/buckets/<name>/metrics` and `/aws/s3/buckets/<name>/metadata`, which show the area's "no screen yet" page. The emulator stores metrics configurations and a metadata configuration; one metadata operation is the only 501 met while planning issue 256.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api list-bucket-metrics-configurations / list-bucket-analytics-configurations (a fresh bucket)   -> ok, empty
$ PutBucketMetricsConfiguration (SDK, through the engine)   -> ok, then listed
$ aws s3api get-bucket-metadata-configuration (a fresh bucket)   -> MetadataConfigurationNotFound
$ CreateBucketMetadataConfiguration (SDK, through the engine)   -> ok; GetBucketMetadataConfiguration then returns the journal and inventory table results, TableStatus CREATING
$ aws s3api get-bucket-metadata-table-configuration   -> 501 NotImplemented "operation GetBucketMetadataTableConfiguration is scaffolded but not implemented in this emulator"
Not called: CloudWatch's metrics of the namespace AWS/S3 for a bucket; whether TableStatus ever leaves CREATING.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. Choose the tab "Metrics", then "Metadata".
4. Each page says there is no screen yet.

## Expected
- "Metrics" shows the bucket's metrics configurations and what the emulator's CloudWatch holds for the bucket (the requirement finds it by calling); a configuration can be created and deleted.
- "Metadata" shows the bucket's metadata configuration and its tables' status, and one can be created and deleted; the 501 of the older operation is not called, or is shown as "not implemented" if the requirement needs it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
S3 Tables' own screens. Storage Lens. CloudWatch's own screens. Any engine change. Anything sent to real AWS.
