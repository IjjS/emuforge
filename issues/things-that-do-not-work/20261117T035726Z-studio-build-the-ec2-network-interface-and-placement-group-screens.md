Issue-Id: 396
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|network-interfaces-and-placement-groups
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 network interface and placement group screens

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/network-interfaces` and `/aws/ec2/placement-groups` show the area's "no screen yet" page. The emulator's lists answer, and a launched instance has a network interface.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-network-interfaces   -> 200
$ aws ec2 describe-placement-groups   -> 200, none
$ aws ec2 describe-instances --instance-ids <id>   -> NetworkInterfaces with one interface, its private address and association
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and launch an instance.
2. Open `/aws/ec2/network-interfaces`.
3. The page says there is no screen yet.

## Expected
- The emulator's network interfaces and placement groups are listed with their pages, and can be created and deleted where the emulator answers.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
An instance's "Networking" tab. Any engine change. Anything sent to real AWS.
