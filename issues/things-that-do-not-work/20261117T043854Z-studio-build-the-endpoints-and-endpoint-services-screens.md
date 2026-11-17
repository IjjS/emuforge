Issue-Id: 428
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|endpoints
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build the "Endpoints" and "Endpoint services" screens

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/vpc/endpoints` and `/aws/vpc/endpoint-services` show the area's "no screen yet" page (captures `17-endpoints`, `18-endpoint-services`). The emulator holds VPC endpoints and endpoint service configurations.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 describe-vpc-endpoints; describe-vpc-endpoint-service-configurations (fresh emulator)   -> ok, empty
$ aws ec2 describe-vpc-endpoint-services   -> ok, a long list of services
$ aws ec2 create-vpc-endpoint --vpc-id <vpc> --service-name com.amazonaws.us-east-1.s3 --route-table-ids <rtb>   -> ok, a Gateway endpoint
$ aws ec2 create-vpc-endpoint --vpc-endpoint-type Interface --service-name com.amazonaws.us-east-1.sqs --subnet-ids <subnet>   -> refused for its input (the VPC's DNS attributes)
$ aws ec2 create-vpc-endpoint-service-configuration --network-load-balancer-arns <arn>   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/vpc/endpoints`.
3. The page says there is no screen yet, and the side navigation "VPC" has the one link "Your VPCs".

## Expected
- The emulator's endpoints and endpoint service configurations are listed with the console's columns the emulator answers, with paging by the API's token and the API's filters; one can be opened, created and deleted, and changed where the emulator answers the change; the emulator's refusal is shown as it came.
- The side navigation "VPC" gains the entry, in the console's place.
- The services an endpoint can be made for are read with paging, never all at once.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
VPC Lattice's lists (their own issue). Any engine change. Anything sent to real AWS.
