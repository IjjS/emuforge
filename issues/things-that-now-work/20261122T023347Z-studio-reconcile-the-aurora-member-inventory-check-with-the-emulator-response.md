Issue-Id: 631
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|rds.aurora-member-read|ci-sign-in-values
Issue-Check-Ids: studio.rds-clusters-made-elsewhere-are-shown
Issue-Commit: 0c8fc6884e4c44b752f03ecd05e24e52ffb56d7e

# Reconcile the Aurora member inventory check with the emulator response

> Identified against commit `0c8fc6884e4c44b752f03ecd05e24e52ffb56d7e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The inventory scenario compares Aurora member sign-in fields to direct emulator reads. The check expected absent values on the member while the emulator returned the cluster's master username and database name.

## Evidence

Ubuntu push run https://github.com/IjjS/emuforge/actions/runs/44974046336 selected every service because the shared Studio client factory changed. Emulator 1.0.565. Failed output: .pm/run/ci-0c8fc6884.log. The local branch check passed against 1.0.556.

On emulator 1.0.569, the Ubuntu push run for `54f5f5c1b` selected every service. The Aurora inventory check failed one of its eight criteria. See `.pm/run/ci-54f5f5c1b.log` and the [GitHub Actions run](https://github.com/IjjS/emuforge/actions/runs/45045315186). The local main reproduction is recorded in `output/checks/2026-11-23T015520.json` and `.pm/run/main-image-1.0.569.log`.

## Steps to Reproduce

1. Use the loopback emulator version and integration IDs identified above.
2. Compare the direct emulator response with the failing assertion in the saved CI log.

## Expected

The inventory describes the member and its cluster consistently with the direct emulator response. All eight criteria are accounted for.

## Out of scope

Lambda versions and aliases.
