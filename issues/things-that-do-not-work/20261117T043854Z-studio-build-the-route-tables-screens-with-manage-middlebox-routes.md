Issue-Id: 421
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|route-tables
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "Route tables" screens, with "Manage middlebox routes"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/route-tables` shows the area's "no screen yet" page (capture `docs/aws-console/vpc/04-route-tables`), and so does a route table's page, `/aws/vpc/route-tables/route-table/{id}`, which the "Main route table" links of the VPC screens (issue 282) lead to. The entry "Manage middlebox routes" of the Your VPCs "Actions" menu is left out there. The emulator holds route tables, a main one per VPC.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-route-tables (fresh emulator)   -> ok, the default VPC's main route table
$ aws ec2 describe-route-tables --filters Name=association.main,Values=true Name=vpc-id,Values=<a>,<b>   -> ok, one per VPC
$ aws ec2 create-route-table --vpc-id <vpc>; create-route --destination-cidr-block 0.0.0.0/0 --gateway-id <igw>; associate-route-table --subnet-id <subnet>   -> ok, the route and the association read back
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/route-tables`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's route tables are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- A route table's page is at `/aws/vpc/route-tables/route-table/{id}` with its routes and subnet associations; a route can be added and removed.
- "Manage middlebox routes" is in the Your VPCs "Actions" menu once a source shows what it opens.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Edge associations and route propagation, unless the requirement finds the emulator stores them. Any engine change. Anything sent to real AWS.
