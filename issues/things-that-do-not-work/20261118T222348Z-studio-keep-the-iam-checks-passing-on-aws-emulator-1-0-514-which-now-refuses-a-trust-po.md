Issue-Id: 492
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|iam|checks-fail-on-emulator-1.0.514-principal-validation
Issue-Check-Ids:
Issue-Commit: bee3d7998d738a24ff297afafb956d0ed876a6a2

# Keep the IAM checks passing on aws-emulator 1.0.514, which now refuses a trust policy whose principal is not a valid service

> Identified against commit `bee3d7998d738a24ff297afafb956d0ed876a6a2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main` at `bee3d79` (the push of issue 485) failed in `integration`, both runs, on two IAM checks, with
every other step passing: https://github.com/IjjS/emuforge/actions/runs/44405315425 . The runner built the emulator
from `infra/aws-emulator` as 1.0.514 (the newest package; the owner's machine and every local check of the day ran
1.0.498). 1.0.514 refuses `CreateRole` with `400 MalformedPolicyDocument` "Invalid principal in policy" when the trust
policy's `Service` principal is not a valid service name:

- `studio.iam-role-screens-talk-only-to-the-engine` (error, setup): its direct `CreateRole` of the role
  `…safety-markup` puts markup in the principal (`"Service": "<img src=x onerror=alert(1)>"`) to prove the screens
  render it as text; the emulator now refuses to hold such a role.
- `studio.iam-role-create-appears-in-the-emulator` (failed, 2 of 7 lines, a `toHaveURL` after "Create role"): likely
  the same refusal of a principal the check gives the form; to be confirmed from the run's log.

Not caused by issue 485 (it changes neither IAM's screens nor these checks); any push would fail the same way now.
What the requirement has to settle: the checks' data under the emulator's new rule (markup is still proven to render
as text, where the emulator still holds it: a role's description, a tag value, a policy's other fields), and whether
the form's own rule or message for a principal changes with the emulator's answer.

## Evidence

The run above; log `.pm/run/ci-bee3d79.full.log` in the main checkout. The services the run selected: every service
(a shared path changed). Emulator 1.0.514 (runner) against 1.0.498 (local).

## Steps to Reproduce

Refresh the machine's image (`pm-emulator-image refresh`, which builds 1.0.514 now) and run the two checks with
`pm-check --checks`.

## Expected

Both checks pass on 1.0.514 and still prove what they prove.

## Out of scope
