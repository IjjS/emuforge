Issue-Id: 488
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.failure-states|copies-per-service
Issue-Check-Ids:
Issue-Commit: c1dc8cf4b31e234b1269b2d368271ef6041fa293

# Move Lambda, IAM and S3 onto the AWS area's shared failure states

> Identified against commit `c1dc8cf4b31e234b1269b2d368271ef6041fa293`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 481 lifted the AWS area's failure states into one shared file,
`studio/src/providers/aws/area/components/failure-states.tsx` (the read-failure states, the action-failure flash
item, the connection's status, the code and message, the announcer), and SQS uses it. Lambda, IAM and S3 still
keep their own copies of the same rows: `services/lambda/components/failure-states.tsx` and `failures.tsx`,
`services/iam/components/failures.tsx`, `services/s3/components/action-failure.tsx` and `bucket-read.ts`. Four
copies of one behavior can drift apart: a change to how a failure is shown reaches one service and not the others.
Moving them was left out of issue 481 because it changes those services' files (`.pm/issue-481/design.md`,
"Shared with other services").

## Evidence

- At `c1dc8cf`: the shared file (239 lines) and the per-service copies (Lambda 191 + 57 lines, IAM 175, S3 87 plus
  `bucket-read.ts`) exist side by side; `grep -rn "readFailureState\|actionFailureItem"
  studio/src/providers/aws/area/services` finds definitions in more than one service.

## Steps to Reproduce

1. At `c1dc8cf`, list the definitions of the read-failure and action-failure helpers under
   `studio/src/providers/aws/area/`.
2. They are defined once in `components/failure-states.tsx` and again in Lambda, IAM and S3.

## Expected

- Lambda, IAM and S3 show their read and action failures through `components/failure-states.tsx`; no service keeps
  its own definition of those states.
- Each service's screens show the same failure texts as before (their unit cases and integration checks pass
  unchanged).

## Out of scope

- Changing what a failure says or how it looks; SQS, which already uses the shared file.
