Issue-Id: 392
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|security-groups
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 security group screens: list, detail, create, rules, delete

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/security-groups` shows the area's "no screen yet" page. The emulator holds security groups (a fresh one has `default`), and an instance names its groups. The console shows security groups under EC2 and under VPC; the VPC issue (#282) does not name them.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-security-groups   -> 200, one group `default` on a fresh emulator
$ aws ec2 create-security-group --group-name p73-sg ...   -> 200; an instance launched with it reports it
$ aws ec2 run-instances ... --security-group-ids sg-0000000000000ffff   -> 400 InvalidGroup.NotFound
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/security-groups`.
3. The page says there is no screen yet.

## Expected
- The emulator's security groups are listed; one opens on its page with its inbound and outbound rules; a group can be created, its rules edited, and deleted.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
"Change security groups" of an instance (the Actions issue). Any engine change. Anything sent to real AWS.
