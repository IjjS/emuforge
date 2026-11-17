Issue-Id: 455
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|access-points
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Build the S3 "Access Points" screens: the list, create and delete, and a bucket's access points

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's S3 navigation has the entry "Access Points"; Studio has no screen for access points, and a bucket's page (issue 256) has no "Access Points" tab (issue 256, question 2: no source showed the tab). The emulator holds access points through S3 Control, and an access point outlives its bucket.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
$ PUT /v20180820/accesspoint/p256-ap (S3 Control, header x-amz-account-id, the bucket in the body)   -> ok, AccessPointArn arn:aws:s3:us-east-1:000000000000:accesspoint/p256-ap and an Alias ending -s3alias
$ GET /v20180820/accesspoint   -> ok, the access point with Name, NetworkOrigin Internet, Bucket, AccessPointArn, Alias
$ GET /v20180820/accesspoint?bucket=p256-plain (a bucket with none)   -> InvalidRequest "No access point attached to this bucket"
$ aws s3api delete-bucket --bucket p256-delap (an access point attached)   -> ok; the access point is still listed afterwards, naming the deleted bucket
Not called: GetAccessPoint, DeleteAccessPoint, an access point's policy, requests through an access point's alias; whether the engine relays S3 Control's requests as the browser's SDK sends them.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator, create a bucket and an access point for it with the AWS CLI.
2. Open `/aws/s3/buckets`.
3. The navigation has no entry "Access Points", and no screen shows the access point.

## Expected
- The navigation's entry leads to the list of the emulator's access points; one can be created for a bucket, opened and deleted; the emulator's answer is shown, and the answer for a bucket with none is shown as an empty list, not as an error.
- A bucket's access points are shown on the bucket's page where the console shows them (the owner's capture of a bucket's page decides the tab).
- An access point whose bucket is gone is listed as the emulator returns it, and the screen says so in EmuForge's own words.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Access Points for FSx. Object Lambda access points. Multi-Region access points. Any engine change. Anything sent to real AWS.
