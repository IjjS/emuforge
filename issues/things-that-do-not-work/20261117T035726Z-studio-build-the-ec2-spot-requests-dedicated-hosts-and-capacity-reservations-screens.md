Issue-Id: 399
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|spot-hosts-capacity
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Spot Requests, Dedicated Hosts and Capacity Reservations screens

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The paths of "Spot Requests", "Dedicated Hosts", "Capacity Reservations", "UltraServers" and "Capacity Manager" under `/aws/ec2` show the area's "no screen yet" page. The emulator's lists answer 200 and empty on a fresh emulator, which by itself does not show that the resources can exist: this issue's requirement finds out by creating each, and a group the emulator cannot hold is `omitted` from the navigation with that evidence.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-spot-instance-requests   -> 200, none
$ aws ec2 describe-spot-fleet-requests   -> 200, none
$ aws ec2 describe-hosts   -> 200, none
$ aws ec2 describe-capacity-reservations   -> 200, none
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/spot-requests`.
3. The page says there is no screen yet.

## Expected
- Each group the emulator can hold has its list, page, create and delete; each it cannot is left out with the emulator's answer.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Savings Plans and Reserved Instances (purchases). Any engine change. Anything sent to real AWS.
