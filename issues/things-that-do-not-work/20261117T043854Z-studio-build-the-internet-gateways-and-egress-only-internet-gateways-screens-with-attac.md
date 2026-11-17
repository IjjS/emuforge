Issue-Id: 422
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|internet-gateways
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "Internet gateways" and "Egress-only internet gateways" screens, with "Attach" > "Internet gateway"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/internet-gateways` and `/aws/vpc/egress-only-internet-gateways` show the area's "no screen yet" page (captures `05-internet-gateways`, `06-egress-only-internet-gateways`). The sub-menu "Attach" of the Your VPCs "Actions" menu (issue 282) is left out. The emulator holds both kinds of gateway.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-internet-gateways (fresh emulator)   -> ok, the default VPC's gateway
$ aws ec2 create-internet-gateway; attach-internet-gateway --vpc-id <vpc>; detach-internet-gateway; delete-internet-gateway   -> ok
$ aws ec2 describe-egress-only-internet-gateways (fresh emulator)   -> ok, empty
$ aws ec2 create-egress-only-internet-gateway --vpc-id <vpc>   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/internet-gateways`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's internet gateways and egress-only internet gateways are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- A gateway can be attached to a VPC and detached; "Attach" > "Internet gateway" is in the Your VPCs "Actions" menu.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
"Attach" > "Transit gateway" and "Virtual private gateway" (their own issues). Any engine change. Anything sent to real AWS.
