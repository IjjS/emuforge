Issue-Id: 496
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|dynamodb|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 3690c34ad1434164a960c06643b9e8d9fdf1374d

# Build DynamoDB's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `3690c34ad1434164a960c06643b9e8d9fdf1374d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

DynamoDB by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as issues 480 (S3) and 481 (SQS,
on `main`) did: find what the emulator supports of DynamoDB, break what a developer does with it locally into tasks
(likely at the core: see the tables and their keys, explore and query a table's items, put, edit and delete an item;
then create and delete a table, indexes, streams, TTL), order them by importance and build from the top. Issue 72
planned DynamoDB the old way (list, page, create form); its branches `feat/72`, `feat/72-t1`, `feat/72-t2` (check
support and seed for tables) and `feat/72-s1` (a data layer) may be taken from where they serve. Issue 330 (the item
screens) is one of the tasks. SQS's shared parts on `main` (`components/failure-states.tsx`) are used where they fit.

## Evidence

The owner's decisions of 2026-11-18 (`.pm/archive/478/`); issue 72's `.pm/issue-72/` (its probes) and branches.

## Steps to Reproduce

Open `/aws/dynamodb`: "No screen yet".

## Expected

A developer can do DynamoDB's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope
