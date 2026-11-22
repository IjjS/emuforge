Issue-Id: 634
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|push-integration-time-bound|all-service-45min-headroom
Issue-Check-Ids:
Issue-Commit: 50518a8f27de5dcab6e463ebe04648f0ff92a4b7

# Raise the 45-minute push integration bound from the measured all-service run

> Identified against commit `50518a8f27de5dcab6e463ebe04648f0ff92a4b7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The Ubuntu push integration step took 23m36s with every service selected. This exceeds half of the current 45-minute timeout (22m30s). The run finished within its timeout and failed one EC2 assertion tracked by #633.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/45080373243 on 50518a8f2. The services step selected every service because studio/src/lib/aws/request.ts is shared. Integration started at 23:07:15Z and ended at 23:30:51Z on November 22.

## Steps to Reproduce

1. Read the services selection and integration step timestamps for the recorded push.
2. Compare the elapsed duration with the integration timeout in .github/workflows/main.yml.

## Expected

The push integration timeout provides at least twice the measured duration for the all-service run.

## Out of scope

Changes to the EC2 acceptance criteria, service selection, or full-tier workflow.
