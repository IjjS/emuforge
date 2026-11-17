Issue-Id: 456
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|navigation-other-entries
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Find out what the emulator holds for the rest of the S3 navigation and build the screens of what it holds: File systems, Access Points for FSx, Access Grants, IAM Access Analyzer, Storage Lens, Batch Operations, account settings

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's S3 navigation has further entries Studio's does not (issue 56, R5.2): "File systems", "Access Points for FSx", "Access Grants", "IAM Access Analyzer", "Storage Lens", "Batch Operations" and the account and organization settings. What the emulator answered for each was found while planning issue 56 and not again for issue 256; this issue's requirement calls each first and cuts an entry that is large into an issue of its own.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
(all called while planning issue 56, on an earlier emulator)
$ s3files ListFileSystems   -> ok, empty; creating one not called
$ fsx DescribeFileSystems   -> ok, empty; not called further
$ s3control ListAccessGrantsInstances   -> 501 NotImplemented (a create answers ok)
$ accessanalyzer: analyzers created and listed, ListFindings returns findings for a shared bucket, GetAnalyzedResource ok; ListFindingsV2, GetFindingsStatistics and ListAnalyzedResources -> 501
$ s3control Storage Lens configurations   -> put, read and listed; no default dashboard, no metrics
$ s3control ListJobs   -> ok, empty; creating one not called
$ s3control account-level public access block   -> put, read and deleted
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/s3/buckets`.
3. The navigation has none of these entries.

## Expected
- The requirement states, per entry, the operations and what the emulator answers to each, by calling it; an entry with data of the emulator gets its screens, and an entry answered 501 or holding nothing that can be made is recorded as left out with the calls that show it, with no screen.
- The account's Block Public Access settings can be read and changed, with the confirmation the console asks for.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The External access summary panel (issue 58). AWS Marketplace for S3. Table buckets, vector buckets, access points and directory buckets (their own issues). Any engine change. Anything sent to real AWS.
