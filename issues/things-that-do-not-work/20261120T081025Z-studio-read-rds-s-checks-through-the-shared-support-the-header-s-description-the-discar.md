Issue-Id: 592
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|rds.checks|own-copies-of-shared-support
Issue-Check-Ids:
Issue-Commit: 862340ba0b25bc22f761d2e5f7570aa4e53f9949

# Read RDS's checks through the shared support: the header's description, the discard words, a pair's value

> Identified against commit `862340ba0b25bc22f761d2e5f7570aa4e53f9949`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration checks of RDS's screens (issue 573) hold two rough edges the end review named:

- `tests/integration/studio/rds-clusters.spec.ts`, the line "S7, whose description names the cluster", asserts
  that the page's `main` holds the cluster's identifier anywhere; any other text of the page that holds it would
  pass too. `support/screen-rules.ts` has the page header's description (`pageHeader`).
- `tests/integration/studio/services/rds/rds.ts` repeats `DISCARD_HEADER`, `KEEP_EDITING`, `DISCARD` and
  `valueLocator`, which `support/screen-rules.ts` holds as `DISCARD_HEADING`, `KEEP_EDITING`, `DISCARD` and
  `pairValueOf` (`tests/integration/AGENTS.md`: "a check does not build its own copy"). `services/ec2/ec2.ts` does
  the same.

A check of a merged issue is changed only on the `pm`'s decision; this file is where that decision is asked.

## Evidence

The end review of issue 573, `review-impl-r1.md`, P3 1 and 2 (kept in `.pm/archive/573/` once the issue is
archived). `grep -n "DISCARD\|KEEP_EDITING\|pairValueOf" tests/integration/studio/support/screen-rules.ts
tests/integration/studio/services/rds/rds.ts tests/integration/studio/services/ec2/ec2.ts` names both copies.

## Steps to Reproduce

1. Read `tests/integration/studio/rds-clusters.spec.ts` at the line of S7's description.
2. Run the grep above.

## Expected

- The line of S7's description asserts the cluster's identifier in the page header's description.
- RDS's support imports the shared discard words; a reader of its own stays only where the shared one does not
  serve (a value scoped to one section), and says so.
- The five checks of RDS that run in a push run pass as before, each line asserting what its criteria line says.

## Out of scope

- EC2's support, unless the `pm` adds it to this issue.
