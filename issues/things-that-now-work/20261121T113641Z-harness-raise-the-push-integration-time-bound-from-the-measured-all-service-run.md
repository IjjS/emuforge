Issue-Id: 628
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|push-integration-time-bound|insufficient-headroom
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 937800f4b95269cc656bae24c490b0c2125ce3b8

# Raise the push integration time bound from the measured all-service run

> Identified against commit `937800f4b95269cc656bae24c490b0c2125ce3b8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The all-service push integration step consumed 22m19s of its 30-minute bound. The PM rule calls for raising the bound when the measured integration time exceeds half of it.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44893383185 on 937800f4b. The shared Studio client factory selected every service. The successful integration step ran from 10:25:08Z through 10:47:27Z.

## Steps to Reproduce

1. Inspect the services decision and integration step timestamps of the referenced Ubuntu push run.
2. Compare the elapsed time with the integration timeout in .github/workflows/main.yml.

## Expected

The push integration bound provides the required headroom over the measured run.

## Out of scope

Changing service selection, excluding checks or running a new workflow.
