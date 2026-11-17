Issue-Id: 406
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|clusters
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Show DB clusters in Databases: cluster rows, "Group resources", a cluster's page, create, modify, failover, stop, start and delete

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The Databases list (issue 245) holds DB instances only: a member of a DB cluster is a row with Role "-", the console's toggle "Group resources" is not built, and nothing shows or creates a cluster (the console's "Create database" menu and its dialog "Create with express configuration in seconds" included). The emulator holds DB clusters and their members.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ aws rds create-db-cluster --engine aurora-postgresql ...   -> ok (version 17.9)
$ aws rds create-db-cluster --engine aurora-mysql --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=2   -> ok (8.0.mysql_aurora.3.10.3)
$ aws rds create-db-cluster --engine postgres --db-cluster-instance-class db.m5d.large --allocated-storage 100 --storage-type io1 --iops 1000   -> ok, a Multi-AZ DB cluster
$ aws rds create-db-instance --db-cluster-identifier <cluster> --engine aurora-postgresql --db-instance-class db.r6g.large   -> ok; describe-db-clusters lists DBClusterMembers with IsClusterWriter
$ aws rds describe-db-clusters --filters Name=db-cluster-id,Values=a,b   -> ok; --max-records 19 -> refused
$ aws rds describe-db-cluster-endpoints   -> ok, WRITER and READER
$ aws rds modify-db-cluster; failover-db-cluster (the writer changes); stop-db-cluster and start-db-cluster (the members stop too); create-db-cluster-snapshot   -> ok
$ aws rds delete-db-cluster with deletion protection   -> InvalidParameterCombination; with members -> InvalidDBClusterStateFault; with neither --skip-final-snapshot nor a final snapshot name -> InvalidParameterCombination; with a final snapshot name -> ok, the snapshot exists
$ aws rds delete-db-instance of a member, with --skip-final-snapshot or with a final snapshot name   -> ok (a DB snapshot is made); the last member too, and the cluster stays available with no member
$ aws rds create-global-cluster; delete-global-cluster   -> ok
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create an `aurora-postgresql` cluster and a member instance with the AWS CLI.
2. Open `/aws/rds/databases`.
3. The member is listed with Role "-"; the cluster is not listed.

## Expected
- Databases lists clusters and instances as the console does, with "Group resources" and the members' roles, paging without loading everything (the two list operations page separately; the requirement decides how).
- A cluster has its page; a cluster can be created, modified, failed over, stopped, started and deleted; the emulator's refusals are shown as they came.
- What the console's delete dialog offers for a cluster's member is found from a capture or the Aurora user guide.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Global databases beyond listing unless the requirement takes them up. Limitless and shard groups. Any engine change. Anything sent to real AWS.
