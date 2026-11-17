Issue-Id: 407
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|create-database-more
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Add to "Create database": engines with an edition, "Templates", managed credentials, storage, "Connectivity", Multi-AZ and classes read from the emulator

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
"Create database" (issue 245) offers MariaDB, MySQL and PostgreSQL, three classes written into Studio, a version, an identifier, master credentials and the storage size. The user guide's form has more: "Easy create", the engines with "Database management type" and "Edition", "Templates", credentials "Managed in AWS Secrets Manager" and "Auto generate a password" with "View credential details", "Storage type", "Connectivity", "Multi-AZ deployment" and the additional settings. The emulator accepts more than the form sends.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds create-db-instance --engine oracle-se2 ...; --engine sqlserver-ex ...   -> ok
$ aws rds create-db-instance --manage-master-user-password   -> ok; describe-db-instances returns MasterUserSecret {SecretArn, SecretStatus, KmsKeyId}
$ aws rds create-db-instance without --allocated-storage, --master-username or a password   -> ok (those members are then missing)
$ aws rds create-db-instance --db-subnet-group-name <missing>   -> DBSubnetGroupNotFoundFault
$ aws rds create-db-instance --db-instance-class db.nope.huge   -> InvalidParameterValue "Invalid DB Instance class: db.nope.huge"
$ aws rds describe-orderable-db-instance-options; describe-db-engine-versions; describe-db-major-engine-versions   -> ok, with data
$ aws ec2 describe-vpcs; describe-subnets; describe-security-groups   -> ok, a default VPC with three subnets and a security group
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/rds/databases/create`.
3. "Engine type" offers three engines; there is no "Templates", no credentials management choice, no "Connectivity".

## Expected
- The form offers what the requirement finds the emulator accepts and stores: the further engines, the classes of `DescribeOrderableDBInstanceOptions` for the chosen engine, managed credentials, storage type, the VPC's subnet group and security groups, Multi-AZ, deletion protection; each sent value is read back from the emulator.
- A secret the emulator makes is never shown, stored or logged by Studio beyond what the console shows on the user's action.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Aurora and Multi-AZ DB clusters (the cluster issue). RDS Custom. Any engine change. Anything sent to real AWS.
