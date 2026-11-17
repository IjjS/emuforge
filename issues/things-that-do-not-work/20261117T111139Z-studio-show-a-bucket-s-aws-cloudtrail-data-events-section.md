Issue-Id: 451
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3.bucket-properties|cloudtrail-data-events
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Show a bucket's "AWS CloudTrail data events" section

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The "Properties" tab of a bucket's page (issue 256) has no section "AWS CloudTrail data events": it is the one item of the reference spec `studio/references/console/s3/bucket-properties.yaml` that issue 256 leaves unbuilt, because it needs CloudTrail's client, which Studio does not have yet and no unit of issue 256 could add. The emulator holds trails with data event selectors for a bucket.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ aws cloudtrail create-trail --name p256-trail --s3-bucket-name p256-logs (the bucket's policy allows cloudtrail.amazonaws.com)   -> ok
$ aws cloudtrail put-event-selectors --trail-name p256-trail --event-selectors (DataResources of Type AWS::S3::Object for the bucket's ARN)   -> ok
$ aws cloudtrail get-event-selectors --trail-name p256-trail   -> ok, the selector with the bucket's ARN
$ aws cloudtrail list-trails   -> ok, the trail
Not called: advanced event selectors; a trail of another Region.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. The tab "Properties" has no section "AWS CloudTrail data events".

## Expected
- The section lists the trails whose data event selectors name the bucket, read from the emulator through the engine, and says "not set" in EmuForge's own words when none does; the spec's item matches (59/59).
- A trail's name leads to the trail's screen once CloudTrail's screens exist (the CloudTrail issue), and to nothing before.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
CloudTrail's own screens (their own issue). Creating a trail from the bucket's page. Any engine change. Anything sent to real AWS.
