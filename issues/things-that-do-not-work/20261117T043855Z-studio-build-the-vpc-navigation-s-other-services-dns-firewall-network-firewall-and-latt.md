Issue-Id: 435
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|firewall-and-lattice
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the VPC navigation's other services: "DNS firewall", "Network Firewall" and "Lattice services"

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's VPC navigation holds groups whose lists are other APIs' (captures `19-service-networks` to `33-container-associations`): "DNS firewall" (Route 53 Resolver: "Rule groups", "Domain lists"), "Network Firewall" ("Firewalls", "Firewall policies", "Network Firewall rule groups" and more) and "PrivateLink and Lattice" ("Lattice services" and five more lists). Their routes below `/aws/vpc/` show the area's "no screen yet" page. The emulator holds some of them and answers 501 for others.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws route53resolver list-firewall-rule-groups (fresh emulator) -> ok, empty; list-firewall-domain-lists -> ok, with lists
$ aws route53resolver create-firewall-rule-group; create-firewall-domain-list   -> ok
$ aws network-firewall list-firewalls; list-firewall-policies; list-rule-groups (fresh emulator)   -> ok, empty
$ aws network-firewall create-rule-group (STATELESS); create-firewall-policy; create-firewall --vpc-id <vpc> --subnet-mappings SubnetId=<subnet>   -> ok
$ aws network-firewall list-tls-inspection-configurations; list-vpc-endpoint-associations   -> 501 NotImplemented
$ aws vpc-lattice list-services -> ok, empty; create-service -> ok
$ aws vpc-lattice list-service-networks; list-resource-configurations; list-resource-gateways; list-target-groups; list-domain-verifications   -> 501 NotImplemented
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/firewalls`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- Each list the emulator answers shows what it holds, and one of each can be created and deleted where the emulator answers it; the requirement decides whether these screens live under `/aws/vpc` as in the console's navigation or under their own service, and splits the issue by service if it is more than one issue's work.
- A list whose operation answers 501 says "not implemented", never an empty list.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether a firewall filters anything. Any engine change. Anything sent to real AWS.
