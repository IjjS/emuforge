Issue-Id: 423
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|nat-gateways
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "NAT gateways" screens

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/nat-gateways` shows the area's "no screen yet" page (capture `docs/aws-console/vpc/11-nat-gateways`). The emulator holds NAT gateways.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-nat-gateways (fresh emulator)   -> ok, empty
$ aws ec2 allocate-address; create-nat-gateway --subnet-id <subnet> --allocation-id <eip>   -> ok, State pending
$ aws ec2 describe-nat-gateways   -> ok, the gateway with its state
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/nat-gateways`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's NAT gateways are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Elastic IPs (issue #395). Any engine change. Anything sent to real AWS.
