Issue-Id: 395
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|elastic-ips
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Elastic IP screens: list, allocate, associate, disassociate, release

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/addresses` shows the area's "no screen yet" page. The emulator holds Elastic IP addresses and associates them: an associated instance's public address becomes the Elastic IP.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-addresses   -> 200, none on a fresh emulator
$ aws ec2 allocate-address   -> 200
$ aws ec2 associate-address --instance-id <id> --allocation-id <eipalloc>   -> 200; the instance's PublicIpAddress is the address and Association.IpOwnerId the account's ID
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and allocate an address with the AWS CLI.
2. Open `/aws/ec2/addresses`.
3. The page says there is no screen yet.

## Expected
- The emulator's addresses are listed; one can be allocated, associated with an instance, disassociated and released.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The Instances list's "Elastic IP" column (issue 73). Any engine change. Anything sent to real AWS.
