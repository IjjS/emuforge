Issue-Id: 424
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|dhcp-option-sets
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "DHCP option sets" screens

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/dhcp-option-sets` shows the area's "no screen yet" page (capture `docs/aws-console/vpc/08-dhcp-option-sets`), and so does a set's page, `/aws/vpc/dhcp-option-sets/dhcp-option-set/{id}`, which the "DHCP option set" links of the VPC screens (issue 282) lead to. The emulator holds DHCP option sets, one from its start.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-dhcp-options (fresh emulator)   -> ok, one set
$ aws ec2 create-dhcp-options --dhcp-configurations Key=domain-name,Values=<name> --tag-specifications ...   -> ok, with its tags
$ aws ec2 describe-dhcp-options --filters Name=dhcp-options-id,Values=<a>,<b>   -> ok; an ID it does not hold is passed over (with --dhcp-options-ids the call is refused, InvalidDhcpOptionID.NotFound)
$ aws ec2 associate-dhcp-options --vpc-id <vpc> --dhcp-options-id <set>   -> ok; with `default` the VPC then reads the literal `default`
$ aws ec2 delete-dhcp-options of a set a VPC uses   -> DependencyViolation; after that VPC is deleted -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/dhcp-option-sets`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's DHCP option sets are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- A set's page is at `/aws/vpc/dhcp-option-sets/dhcp-option-set/{id}`. A VPC whose option set reads `default` leads to a page that says what the emulator answers for it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Changing a VPC's option set (the issue of a VPC's changes). Any engine change. Anything sent to real AWS.
