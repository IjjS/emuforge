Issue-Id: 390
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|connect
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Connect page of an instance

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Connect" on the Instances list (issue 73) leads to `/aws/ec2/instances/instance/<id>/connect`, which shows the area's "no screen yet" page. In the console "Connect" is a split button with a menu button "More actions" beside it, closed in the owner's capture, its entries in no source. What the emulator answers for the operations behind the page's tabs is this issue's requirement to find out; the serial console's account setting answers.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 get-serial-console-access-status   -> 200
$ aws ec2 get-console-output --instance-id <id>   -> 200
$ aws ec2 get-password-data --instance-id <id>   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and launch an instance.
2. Open `/aws/ec2/instances`, select it and choose "Connect".
3. The page says there is no screen yet.

## Expected
- The page shows the parts of the console's Connect page that the emulator has; a part it lacks is `omitted` with the emulator's answer.
- Nothing opens a connection to a host other than the engine on loopback.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
A terminal in the browser, unless the requirement finds the emulator serves one. Any engine change. Anything sent to real AWS.
