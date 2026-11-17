Issue-Id: 398
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|instance-types
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Instance Types screen

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/instance-types`, where "Compare instance types" of the launch form leads (issue 73), shows the area's "no screen yet" page. The emulator lists 1437 instance types and what each zone offers.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-instance-types --max-results 100 --no-paginate   -> 200, 100 types and a NextToken (1437 in all; MaxResults 101 -> 400 InvalidMaxResults)
$ aws ec2 describe-instance-types --filters 'Name=instance-type,Values=*t3*'   -> 200, 14 types
$ aws ec2 describe-instance-type-offerings --location-type availability-zone --filters Name=location,Values=us-east-1c   -> 200, 42 (us-east-1a: 1437)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/instance-types`.
3. The page says there is no screen yet.

## Expected
- The emulator's instance types are listed page by page with the API's filters, and one opens on its page.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Prices and the type finder, unless the emulator holds something for them. Any engine change. Anything sent to real AWS.
