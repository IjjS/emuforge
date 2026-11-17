Issue-Id: 436
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|dashboard-settings-sorting
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the VPC dashboard and "Settings", and decide the Your VPCs list's sorting and split panel

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc` opens the Your VPCs list (issue 282), where the console opens the "VPC dashboard" (capture `01-vpc-dashboard`), and `/aws/vpc/settings` shows the area's "no screen yet" page (capture `53-settings`: Block Public Access). The Your VPCs list has no sorting and no split panel, which the capture `02-your-vpcs` shows: `DescribeVpcs` takes no sort parameter, and Studio does not load every page to sort in the browser.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-vpc-block-public-access-options   -> ok
$ aws ec2 modify-vpc-block-public-access-options --internet-gateway-block-mode block-bidirectional   -> ok, the account's option changes; every VPC's BlockPublicAccessStates.InternetGatewayBlockMode stays `off`
$ aws ec2 describe-vpc-block-public-access-exclusions   -> ok, empty
$ aws ec2 describe-account-attributes; describe-availability-zones   -> ok
$ aws ec2 describe-vpcs --max-results 5 (14 VPCs)   -> ok, pages of 5, 5, 4 in the order of the IDs; no sort parameter exists
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator (it holds a default VPC).
2. Open `/aws/vpc/vpcs`.
3. No column heading sorts; selecting a row shows nothing below the table.
4. Open `/aws/vpc/settings`: the page says there is no screen yet.

## Expected
- The dashboard shows what the emulator holds per resource kind, each count read with a bounded call, and leads to the lists that exist.
- "Settings" shows and changes the account's Block Public Access option; the screen says what the emulator does with it as a check shows.
- The requirement decides whether the list sorts or shows a split panel, and how, without loading every page.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The console's links to other consoles (Network Manager, Cloud WAN, IPAM, Firewall Manager, AWS Global View). Any engine change. Anything sent to real AWS.
