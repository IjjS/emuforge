Issue-Id: 516
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|lambda|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 6ea093492ca3f4ffe383389c807ad6ed9adb06d0

# Build Lambda's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `6ea093492ca3f4ffe383389c807ad6ed9adb06d0`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Lambda by the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`), as issues 480 (S3), 481 (SQS) and
496 (DynamoDB) did: find what the emulator supports of Lambda, break what a developer does with it locally into
tasks, order them by importance and build from the top. Likely at the core: see the functions and what each is;
create a function from a .zip file; change its code; invoke it with an event and read the result and the log tail;
change its configuration (handler, runtime, memory, timeout, environment variables); delete it; then versions and
aliases, event source mappings (SQS, DynamoDB streams, Kinesis), permissions, layers, function URLs. The emulator runs a
function's code (seen by the owner on 2026-11-19), so "invoke" is a real task.

Lambda's screens on `main` come from issue 84 and its followers, built the old way (a list, a function's page with
tabs copied from the console): the plan keeps what serves a task and rebuilds or removes what does not, and says
which. Issues 344 (the code: upload a .zip, runtime settings) and 345 (the "Test" tab: invoke) are tasks of this
issue and are closed by it; the other open Lambda issues are named in the report as held by a later task or closed
out. The area's shared parts on `main` (the confirm dialog, `components/failure-states.tsx`, the list parts) are used
where they fit.

## Evidence

The owner's decisions of 2026-11-18 (`.pm/archive/478/`) and of 2026-11-19 (the order of services, `.pm/product/services.md`); issues 344 and 345.

## Steps to Reproduce

Open `/aws/lambda`: a function can be seen, but no code can be uploaded and nothing invoked.

## Expected

A developer can do Lambda's core tasks in Studio from start to end, each proven by a business scenario against the real emulator.

## Out of scope
