Issue-Id: 387
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|instance-tabs-and-tags
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build an EC2 instance's further tabs: Status and alarms, Networking, Storage, Tags with Manage tags, and the list's Edit Name

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
An instance's page (issue 73) shows its tab "Details"; the tabs "Status and alarms", "Networking", "Storage" and "Tags" lead to `/aws/ec2/instances/instance/<id>/status-and-alarms`, `networking`, `storage` and `tags`, which show the area's "no screen yet" page. The Instances list has no "Edit Name" button in a row (issue 73, `decisions-needed.md` question 11). The emulator holds what each shows: status checks, network interfaces and addresses, the root volume, tags.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-instance-status --instance-ids <id> --include-all-instances   -> 200, InstanceStatus ok, SystemStatus ok (each with Details reachability passed)
$ aws ec2 describe-instances --instance-ids <id>   -> 200, NetworkInterfaces with PrivateIpAddress and Association, BlockDeviceMappings
$ aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=<id>   -> 200, one volume, 8 GiB, /dev/xvda, DeleteOnTermination true
$ aws ec2 create-tags --resources <id> --tags Key=Name,Value=p73-renamed Key=extra,Value=1   -> 200, read back
$ aws ec2 create-tags --resources <id> --tags Key=aws:reserved,Value=x   -> 400 InvalidParameterValue (the 'aws:' prefix is reserved)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and launch an instance.
2. Open its page from `/aws/ec2/instances` and choose the tab "Tags".
3. The page says there is no screen yet.

## Expected
- Each of the four tabs shows what the emulator holds for the instance; "Manage tags" adds, changes and removes tags and shows the emulator's refusal as it came.
- "Edit Name" in a row of the list changes the `Name` tag.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The "Actions" menu's entries (their own issue). Volumes and network interfaces as lists of their own. Any engine change. Anything sent to real AWS.
