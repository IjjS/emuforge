Issue-Id: 529
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.layers|task
Issue-Check-Ids: 529
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 12: publish a layer and give a function its layers

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 12: a developer publishes a layer from a .zip file and gives a function its layers. Studio has no screen for
layers. The reference is the same request sent straight to aws-emulator: `PublishLayerVersion`, `ListLayers`,
`ListLayerVersions`, `UpdateFunctionConfiguration` with `Layers`. This task takes the place of issue 348.

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-2.log`, "## layers": `PublishLayerVersion` and `ListLayers` answered, and a function given the layer imported
  a module from it when invoked.
- The emulator refuses a request body over 16 MiB with a bare 413 (`probe-7.log`, "## the size of the .zip",
  `probe-8.log`), which bounds a layer's .zip as it bounds a function's (about 12 MB).

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. No screen lists layers or publishes one; "Configuration" shows no layers of the function.

## Expected

- A developer publishes a layer version from a .zip file and sees it among the layers.
- A developer adds a layer version to a function and removes it; the function then runs with or without the layer's code.
- Refusals of the emulator are reported with its code.
- Each proven by a scenario against the real emulator.

## Out of scope

A layer's permissions, layers of another account, deleting layer versions unless the requirement finds the task.
