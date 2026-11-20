Issue-Id: 591
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|rds.pages|address-in-another-letter-case
Issue-Check-Ids:
Issue-Commit: 862340ba0b25bc22f761d2e5f7570aa4e53f9949

# Keep a DB instance's and a DB cluster's page right at an address in another letter case

> Identified against commit `862340ba0b25bc22f761d2e5f7570aa4e53f9949`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The emulator matches `DBInstanceIdentifier` and `DBClusterIdentifier` in any letter case and stores identifiers in
lower case (requirement of issue 573, "What the emulator supports", probe-5). A DB instance's page and a DB
cluster's page key and filter their reads by the identifier in the address, while an action reads again by the
identifier the emulator answered. So at an address typed or bookmarked in another letter case:

- `/aws/rds/instances/instance/My-Db` shows the DB instance `my-db`; after "Stop" the page keeps `available` beside
  "Stopping my-db" until "Refresh", against the requirement's "after the answer the instance is read again".
- `/aws/rds/clusters/cluster/My-C` asks the members with the filter `db-cluster-id` of the address's case, so "DB
  instances" may read "No DB instances" while "Delete" says the cluster has members.

No address Studio builds reaches this: every link and hand-over uses the emulator's identifier.

## Evidence

The end review of issue 573, `review-impl-r1.md`, P2 (kept in `.pm/archive/573/` once the issue is archived), read
from the code: `studio/src/providers/aws/area/services/rds/queries.ts` (`useInstanceAction` re-reads
`RDS_KEYS.instance(<the answered identifier>)`), `pages/instance-page.tsx` (`useInstance(…, id)` with the address's
`id`), `cluster-queries.ts` (`readRound` → `listMembers(endpoint, id)`). Not yet shown on a running app: the first
step of the fix is to reproduce it as below.

## Steps to Reproduce

1. Start an emulator and Studio; create the DB instance `my-db` and wait for `available`.
2. Open `/aws/rds/instances/instance/My-Db`: the page shows `my-db`.
3. Choose "Stop": "Stopping my-db" is shown and "Status" still reads `available` until "Refresh".
4. Create an Aurora DB cluster `my-c` with one member; open `/aws/rds/clusters/cluster/My-C` and read "DB instances".

## Expected

- At an address in another letter case, a DB instance's page follows an action's statuses without a refresh, as at
  the emulator's own identifier.
- At such an address a DB cluster's page lists the cluster's members, and "Delete" agrees with the list.
- A unit case of each page at an address in another letter case.

## Out of scope

- Redirecting such an address to the emulator's identifier.
