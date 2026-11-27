Issue-Id: 691
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|apigateway-rest-stage-address|emulator-1.0.639-exports-aws-host
Issue-Check-Ids: studio.apigateway-create-method-refusals-leave-nothing-half-made
Issue-Commit: ad7355077587e25aa49fc34e8e39d0c48b231935

# On emulator 1.0.639 a REST stage's exported address names an AWS host, and the create-method refusals check fails

> Identified against commit `ad7355077587e25aa49fc34e8e39d0c48b231935`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The push run of `ad735507` failed one integration check, `studio.apigateway-create-method-refusals-leave-nothing-half-made`,
in its first quarter second, before any screen was opened: the check reads a deployed stage's address from the
emulator's `GetExport` (`oas30`, the first server's URL) and asserts that its host is `127.0.0.1` before it types
the address into a form. On the emulator the runner built, 1.0.639, the host was
`<api id>.execute-api.us-east-1.amazonaws.com`. The run before it, on emulator 1.0.635, passed the same check, and
the machine's image is 1.0.633, so the emulator's answer changed between 1.0.635 and 1.0.639. The push itself
(issue 690) changed the workflow's bounds only.

Studio reads the same export for a REST API's stages (`apigateway/rest-api.ts`, the read of a stage's address) and
shows it as "Invoke URL" with a copy control (`components/rest-stages.tsx`). On 1.0.639 that screen would show and
copy an address at an AWS host for a stage that lives in the local emulator. Studio sends nothing to that address
itself (it is plain text, not a link), but a developer who copies it calls real AWS, not the emulator. The check
`studio.apigateway-rest-api-page-shows-what-it-serves` passed in the same run because it compares the cell with the
same export.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/45984349285 (failed; services selected: every service, the push
changed the workflow file). Log `.pm/run/ci-ad7355077.log`, its last lines: "verdict failed Error:
expect(received).toBe(expected) // Object.is equality", "Expected: "127.0.0.1"", "Received:
"ln8y20yi3e.execute-api.us-east-1.amazonaws.com"". The assertion is line 239 of
`tests/integration/studio/apigateway-rest-build.spec.ts`; the helper is `exportedAddress` in
`tests/integration/studio/services/apigateway/apigateway.ts`. Every other check of the run passed. The run on
1.0.635: https://github.com/IjjS/emuforge/actions/runs/45976016323 (passed). A second push run on
1.0.639 failed the same one check and nothing else: https://github.com/IjjS/emuforge/actions/runs/45991664536. Not reproduced locally: the machine's
image is 1.0.633, and refreshing it changes the emulator under the issues in flight.

## Steps to Reproduce

1. On emulator 1.0.639, create a REST API with a method, deploy it to a stage `dev`.
2. `GetExport` with `exportType` `oas30` and read `servers[0].url` with its variables.
3. Open the API's page in Studio and read "Invoke URL" of the stage.

## Expected

- What the emulator answers on 1.0.639, and since which version, is recorded from calls to it (the export's server,
  and whether the emulator serves the stage at a loopback address as before).
- A REST stage's address shown and copied by Studio is one that reaches the local emulator, never an AWS host; where
  the emulator gives no such address, the screen says so instead of showing one.
- The checks that take an address from the export (`exportedAddress` in the REST build and REST API specs) take the
  address Studio is to show, keep the assertion that its host is loopback, and pass on the current emulator.

## Out of scope

HTTP APIs' invoke address (built by Studio, `v2-stages.tsx`), unless the same calls show it changed too.
