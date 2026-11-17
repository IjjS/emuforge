Issue-Id: 429
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|vpn
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the VPN screens: "Customer gateways", "Virtual private gateways", "Site-to-Site VPN connections", "Client VPN endpoints", with "Attach" > "Virtual private gateway"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The routes of the console's navigation group "Virtual private network (VPN)" below `/aws/vpc/` show the area's "no screen yet" page (captures `34-customer-gateways` to `38-client-vpn-endpoints`). The emulator holds customer gateways, VPN gateways and VPN connections; it does not implement VPN concentrators.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-customer-gateways; describe-vpn-gateways; describe-vpn-connections; describe-client-vpn-endpoints (fresh emulator)   -> ok, empty
$ aws ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.12 --bgp-asn 65000   -> ok
$ aws ec2 create-vpn-gateway --type ipsec.1; attach-vpn-gateway --vpc-id <vpc>   -> ok
$ aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id <cgw> --vpn-gateway-id <vgw>   -> ok
$ aws ec2 create-client-vpn-endpoint with a certificate ARN the emulator does not hold   -> refused (certificate not found)
$ aws ec2 describe-vpn-concentrators   -> 501 NotImplemented
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/customer-gateways`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's customer gateways, virtual private gateways, VPN connections and Client VPN endpoints are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- "Site-to-Site VPN Concentrators" says "not implemented" while `DescribeVpnConcentrators` answers 501, never an empty list.
- "Attach" > "Virtual private gateway" is in the Your VPCs "Actions" menu.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether a VPN connection carries traffic. Any engine change. Anything sent to real AWS.
