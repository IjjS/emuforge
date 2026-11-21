Issue-Id: 578
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: gap
Issue-Source: plan
Issue-Key: engine|compose.rds-endpoint-ports|not-reachable
Issue-Check-Ids: engine.compose-databases-answer-on-described-host-ports studio.rds-compose-host-endpoints-match-describe
Issue-Commit: 08ec9b9ff80a1a3ec4e6fc224bfd03ce6e0cbcfe

# Make a database of the emulator reachable from the machine in the Compose forms

> Identified against commit `08ec9b9ff80a1a3ec4e6fc224bfd03ce6e0cbcfe`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The emulator opens a listening socket of its own for every RDS DB instance of `postgres`, `mysql` or `mariadb` and
for every Aurora cluster, at a port it picks itself (33297 to 46513 seen), and reports the address `0.0.0.0`. The
socket is inside the emulator's own host. Neither Compose file publishes such a port:
`infra/aws-emulator/docker-compose.yml` publishes the emulator's API port alone, and the product's
`docker-compose.yml` runs the emulator in the network namespace of the `emuforge` container and publishes Studio's
and the engine's ports only. So a developer who creates a DB instance, in Studio or with the AWS CLI, reads an
endpoint and a port that no client on the machine can connect to. Inside the container the same port is a working
database (a PostgreSQL client signs in and reads rows). The reference is the same request sent straight to
aws-emulator and a client run in the emulator's own network namespace.

## Evidence
- `.pm/issue-573/probe/probe-2.log`, "## 7 from the host: is the endpoint port published?": the container
  publishes `19573/tcp -> 127.0.0.1:19573` alone, and the instance's endpoint port is "closed on the host".
- `.pm/issue-573/probe/probe-2.log` and `probe-3.log` "## 5": in the container's network namespace `psql` signs in
  at that port and reads its rows. Emulator 1.0.533.
- `.pm/issue-573/requirement.md`, "Where the socket is" and "Out of scope".

## Steps to Reproduce
1. Start the emulator from `infra/aws-emulator/docker-compose.yml` (or the product's Compose form).
2. Create a DB instance of `postgres` with a master user name, a password and a database name, signed with the
   emulator's own keys.
3. Read its `Endpoint.Port` with `DescribeDBInstances` and connect to `127.0.0.1` at that port from the machine: the
   port is closed.

## Expected
- A DB instance's or a cluster's endpoint that the emulator reports can be reached by a database client on the
  machine, on a loopback address, in both Compose forms; or the product states where it can be reached.
- Nothing is published on an address other than loopback.

## Out of scope
Studio's RDS screens (issue 573), which show the address and the port as the emulator reports them and say nothing
of where a client reaches them; what they say once this is fixed is its own change. The emulator's choice of port
and its address `0.0.0.0` are upstream's.
