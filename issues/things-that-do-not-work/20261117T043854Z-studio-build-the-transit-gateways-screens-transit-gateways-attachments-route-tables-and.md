Issue-Id: 430
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|transit-gateways
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "Transit gateways" screens: transit gateways, attachments, route tables and policy tables, with "Attach" > "Transit gateway"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The routes of the console's navigation group "Transit gateways" below `/aws/vpc/` show the area's "no screen yet" page (captures `43-transit-gateways` to `47-transit-gateway-multicast`). The emulator holds transit gateways, their VPC attachments, route tables and policy tables; it does not create multicast domains.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-transit-gateways; describe-transit-gateway-attachments; describe-transit-gateway-route-tables; describe-transit-gateway-policy-tables; describe-transit-gateway-multicast-domains (fresh emulator)   -> ok, empty
$ aws ec2 create-transit-gateway   -> ok
$ aws ec2 create-transit-gateway-vpc-attachment --transit-gateway-id <tgw> --vpc-id <vpc> --subnet-ids <subnet>   -> ok
$ aws ec2 create-transit-gateway-route-table; create-transit-gateway-policy-table   -> ok
$ aws ec2 create-transit-gateway-multicast-domain   -> 501 NotImplemented
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/transit-gateways`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's transit gateways, attachments, route tables and policy tables are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- Creating a multicast domain says "not implemented" while the emulator answers 501.
- "Attach" > "Transit gateway" is in the Your VPCs "Actions" menu.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
"Metering policies" (a billing page). Network Manager and Cloud WAN. Any engine change. Anything sent to real AWS.
