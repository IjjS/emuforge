Issue-Id: 537
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|aws.client-factory|retries-quota-refusal
Issue-Check-Ids:
Issue-Commit: fc316e46d9f8382e4e398ec81c6a12268ce9fcd8

# Stop the AWS area's clients from resending a request the emulator refused with IAM's LimitExceeded

> Identified against commit `fc316e46d9f8382e4e398ec81c6a12268ce9fcd8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The IAM client made by `studio/src/lib/aws/client-factory.ts` keeps the SDK's default retry strategy. The SDK
classifies an error named `LimitExceededException` as throttling (`@smithy/service-error-classification`,
`THROTTLING_ERROR_CODES`), and the IAM SDK names the emulator's `LimitExceeded` answer so. A quota refusal of IAM
("Cannot exceed quota for PoliciesPerRole: 10", "A managed policy can have up to 5 versions", "Cannot exceed quota for
PolicySize: 6144") is therefore sent three times, with backoff between them, before Studio shows it. The same request
sent once with the AWS CLI with retries off (`AWS_MAX_ATTEMPTS=1`), or straight to aws-emulator, is answered at once
and the refusal does not change on a second try: it is a quota, not throttling.

## Evidence

Found by issue 535 unit s1 (worktree `emuforge-535-s1`): a unit test of `attachRolePolicies` whose fake engine answered
the second `AttachRolePolicy` with 409 `LimitExceeded` saw that request sent three times
(`expected [ '…/a', '…/b', '…/b', '…/b' ] to deeply equal [ '…/a', '…/b' ]`). The test was changed to another code;
the retry is in the factory, outside that unit.

## Steps to Reproduce

1. Start an emulator and the engine; create a role and attach ten managed policies to it directly.
2. In Studio (once issue 535 adds "Attach policies"), attach an eleventh to the role.
3. Read the requests the page sent to the engine: three `AttachRolePolicy` for the eleventh policy.

## Expected

- A request the emulator refuses with IAM's `LimitExceeded` is sent once, and its refusal is shown after that one
  answer.

## Out of scope

Retries of real throttling answers, and of failures at the network level, if the area keeps them.
