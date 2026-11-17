Issue-Id: 457
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3.bucket-screens|parts-waiting-for-captures
Issue-Check-Ids:
Issue-Commit: 9743b197231a04ff6bb058cf26ddd38b9f7bc4fc

# Settle the parts of a bucket's page, "Create bucket", "Empty bucket" and "Delete bucket" that wait for captures: tab order, header actions, section order, labels

> Identified against commit `9743b197231a04ff6bb058cf26ddd38b9f7bc4fc`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
No capture under `docs/aws-console/s3/` shows a bucket's page, the create form, the empty page or the delete page, so issue 256 took what the user guide does not name from the API's model or left it out (issue 256, questions 2, 3 and 5): the order of a bucket's tabs and whether there is an "Access Points" tab; the actions of the page's header (Studio has "Refresh" only, EmuForge's own); the order of the "Properties" sections and the labels of the fields of "Bucket overview"; the labels of the four Block Public Access settings (Studio shows the API's names "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"); the arrangement of Object Ownership (Studio has one choice of three); the labels of the confirmation fields of the empty and delete pages.

Reference: the AWS console's S3 screens for structure and vocabulary (the Amazon S3 User Guide, and the owner's captures under `docs/aws-console/s3/` in the main checkout, outside git, where one shows the screen). Built to the AWS screen policy (`studio/AGENTS.md`) the way the screens of issue 256 are: `console` screens of the area, a reference spec each under `studio/references/console/s3/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 256 (the full output was kept in that plan's probe logs, `probe-1.log` to `probe-5.log`; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code; a line marked issue 56 was called while planning issue 56, on an earlier emulator):

```
The Amazon S3 User Guide names the tabs each on a page of its own ("Objects" in `using-folders`, "Metadata" in `metadata-tables-create-configuration`, "Properties" in `view-bucket-properties`, "Permissions" in `configuring-block-public-access-bucket`, "Metrics" in `configure-request-metrics-bucket`, "Management" in `how-to-set-lifecycle-configuration-intro`) and nowhere their order or an "Access Points" tab of a bucket.
The guide names "Block public access (bucket settings)" and the four settings by their API names (`access-control-block-public-access`), and no check box label.
The guide names "ACLs disabled" with "Bucket owner enforced" and "ACLs enabled" with "Bucket owner preferred" and "Object writer" (`create-bucket-overview`), not how the form arranges them.
The guide says "confirm ... by entering the bucket name into the text field" (`empty-bucket`, `delete-bucket`) and gives the field no label.
Each of these is marked in the sources file beside its spec under `studio/references/console/s3/`.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a bucket with the AWS CLI.
2. Open `/aws/s3/buckets` and choose the bucket's name.
3. The tabs are in the order of the guide's pages; the header has "Refresh" only.
4. Open `/aws/s3/bucket/create`: the Block Public Access check boxes carry the API's names.

## Expected
- Once the owner has added captures of a bucket's page, of "Create bucket" and of the empty and delete pages, the four reference specs carry the captures' labels and order, their sources files name the captures, and the screens match them; the structure scores pass.
- A header action the capture shows exists and sends its operation or leads to its route.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Anything the captures show that is another issue's (objects, the other tabs, access points). Any engine change. Anything sent to real AWS.
