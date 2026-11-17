Issue-Id: 449
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-management
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build a bucket's "Management" tab: lifecycle rules, replication rules, inventory configurations

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A bucket's tab "Management" (issue 256) leads to `/aws/s3/buckets/<name>/management`, which shows the area's "no screen yet" page. The emulator answers the reads of all three groups; putting them was not probed while planning issue 256, so this issue's requirement does that first.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws s3api get-bucket-lifecycle-configuration (a fresh bucket)   -> NoSuchLifecycleConfiguration
$ aws s3api get-bucket-replication   -> ReplicationConfigurationNotFoundError
$ aws s3api list-bucket-inventory-configurations   -> ok, empty
Not called: put-bucket-lifecycle-configuration, put-bucket-replication, put-bucket-inventory-configuration and their deletes.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. Choose the tab "Management".
4. The page says there is no screen yet.

## Expected
- The requirement states by calling what the emulator stores of each group and whether it acts on it (whether a lifecycle rule ever expires an object, whether a replication rule copies one).
- The tab lists the bucket's lifecycle rules, replication rules and inventory configurations; each can be created, edited and deleted; the emulator's answer, a refusal included, is shown.
- A group the emulator answers 501 for is shown as "not implemented", never hidden.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Storage Lens. Batch Operations. Storage Class Analysis unless the requirement takes it up. Any engine change. Anything sent to real AWS.
