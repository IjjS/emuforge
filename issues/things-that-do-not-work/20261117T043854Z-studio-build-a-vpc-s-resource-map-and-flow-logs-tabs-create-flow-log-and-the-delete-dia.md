Issue-Id: 419
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|vpc|resource-map-flow-logs-delete-cascade
Issue-Check-Ids:
Issue-Commit: a7df76280d69b7bfba07c435cb48cc4131e0b6b7

# Build a VPC's "Resource map" and "Flow logs" tabs, "Create flow log", and the delete dialog's list of a VPC's resources

> Identified against commit `a7df76280d69b7bfba07c435cb48cc4131e0b6b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
On a VPC's page (issue 282) the tabs "Resource map" and "Flow logs" lead to `/aws/vpc/vpcs/vpc/<id>/resource-map` and `…/flow-logs`, and "Create flow log" of the list's "Actions" to `…/create-flow-log`; each shows the area's "no screen yet" page. "Delete VPC" sends one `DeleteVpc`, where the console's dialog lists a VPC's subnets, gateways and other resources and deletes them first (user guide, `delete-vpc`). The emulator holds what these parts show.

Reference: the AWS console's VPC screens for structure and vocabulary (the owner's captures under `docs/aws-console/vpc/` in the main checkout, outside git, and the Amazon VPC User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the VPC screens of issue 282 are: `console` screens of the area, a reference spec each under `studio/references/console/vpc/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 282 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws ec2 create-flow-logs --resource-type VPC --resource-ids <vpc> ...; describe-flow-logs; delete-flow-logs   -> ok
$ aws ec2 describe-subnets / describe-route-tables / describe-internet-gateways / describe-network-acls / describe-security-groups --filters Name=vpc-id,Values=<vpc>   -> ok, the VPC's own resources
$ aws ec2 delete-vpc of a VPC with a subnet, an attached internet gateway or a security group that is not `default`   -> DependencyViolation "The vpc '<id>' has dependencies and cannot be deleted.", nothing deleted
$ aws ec2 delete-vpc of a VPC with only a further route table   -> ok; its route tables, network ACL and security group are gone
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator (it holds a default VPC).
2. Open `/aws/vpc/vpcs`.
3. Open a VPC and choose the tab "Flow logs".
4. The page says there is no screen yet.
5. Create a subnet in a VPC with the AWS CLI, select the VPC, "Actions", "Delete VPC", type `delete`, "Delete".
6. The emulator's refusal is shown; the dialog named none of the VPC's resources.

## Expected
- "Resource map" shows the VPC's subnets, route tables and gateways and how they are connected, as the emulator reports them.
- "Flow logs" lists a VPC's flow logs; one can be created and deleted.
- The delete dialog names the resources the emulator holds in the VPC and deletes them before the VPC, as the console does; a refusal of any step is shown as it came and the dialog says what was and was not deleted, read back from the emulator.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Flow logs of subnets and network interfaces. What a flow log delivers. Any engine change. Anything sent to real AWS.
