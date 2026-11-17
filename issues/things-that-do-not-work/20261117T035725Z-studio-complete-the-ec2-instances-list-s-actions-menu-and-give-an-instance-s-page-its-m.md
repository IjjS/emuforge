Issue-Id: 388
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|instance-actions-menu
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Complete the EC2 Instances list's Actions menu and give an instance's page its menus

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The list's "Actions" menu (issue 73) holds "Instance settings" with "Change stop protection" and "Change termination protection" only. The owner's capture `docs/aws-console/ec2/04-instances` holds the whole menu in its markup: "Instance diagnostics", and the groups "Instance settings" (20 entries, among them "Change shutdown behavior", "Change instance type", "Edit user data", "Modify instance metadata options", "Manage tags"), "Networking" (8), "Security" ("Change security groups", "Modify IAM role", "Get Windows password"), "Image and templates" ("Create image", "Create template from instance", "Launch more like this"), "Storage" ("Attach volume", "Detach volume", "Replace root volume") and "Monitor and troubleshoot" (8, among them "Get system log", "Get instance screenshot"). An instance's page has "Refresh" only: no source shows its header (issue 73, questions 3 and 7); a capture of an instance's page settles it.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 modify-instance-attribute --instance-id <id> --instance-type '{"Value":"t3.small"}'   -> 200 (also while running)
$ aws ec2 monitor-instances --instance-ids <id>   -> 200
$ aws ec2 get-console-output --instance-id <id>   -> 200
$ aws ec2 get-console-screenshot --instance-id <id>   -> 200
$ aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required   -> 200
$ aws ec2 modify-instance-placement --instance-id <id> --tenancy dedicated   -> 501 NotImplemented (operation ModifyInstancePlacement is scaffolded but not implemented in this emulator)
$ aws ec2 modify-instance-credit-specification ...   -> 501 NotImplemented
$ aws ec2 create-image --instance-id <id> --name p73-image   -> 501 NotImplemented
$ aws ec2 describe-instance-topology   -> 501 NotImplemented
$ aws ec2 get-instance-uefi-data --instance-id <id>   -> 501 NotImplemented
(ModifyInstanceMaintenanceOptions: 501 NotImplemented)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and launch an instance.
2. Open `/aws/ec2/instances`, select it and open "Actions".
3. The menu holds "Instance settings" with the two protection entries and nothing else.

## Expected
- The menu has the console's groups and entries in the capture's order; each entry on an operation the emulator answers does its work, and each on an operation answered 501 stays and reports "not implemented by the emulator".
- An instance's page has the menus its capture shows.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The requirement cuts the 44 entries into more than one issue if they do not fit one. "Connect" (its own issue). Any engine change. Anything sent to real AWS.
