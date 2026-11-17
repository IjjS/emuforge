Issue-Id: 425
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|network-acls
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "Network ACLs" screens

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/network-acls` shows the area's "no screen yet" page (capture `docs/aws-console/vpc/14-network-acls`), and so does a network ACL's page, `/aws/vpc/network-acls/network-acl/{id}`, which the "Main network ACL" links of the VPC screens (issue 282) lead to. The emulator holds network ACLs, a default one per VPC.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-network-acls (fresh emulator)   -> ok, the default VPC's network ACL
$ aws ec2 describe-network-acls --filters Name=default,Values=true Name=vpc-id,Values=<vpc>   -> ok, one per VPC
$ aws ec2 create-network-acl --vpc-id <vpc>; create-network-acl-entry --ingress --rule-number 100 --protocol tcp --port-range From=80,To=80 --cidr-block 0.0.0.0/0 --rule-action allow   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/network-acls`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's network ACLs are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- A network ACL's page is at `/aws/vpc/network-acls/network-acl/{id}` with its inbound and outbound rules; a rule can be added and removed.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Security groups (issue #392). Any engine change. Anything sent to real AWS.
