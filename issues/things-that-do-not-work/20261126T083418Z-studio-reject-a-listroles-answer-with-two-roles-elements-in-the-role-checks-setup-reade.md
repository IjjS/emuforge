Issue-Id: 659
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|role-checks.setup-readers|duplicate-roles-element
Issue-Check-Ids:
Issue-Commit: cfc82b4c98a42acdd5fbff659f22138117d4e616

# Reject a ListRoles answer with two Roles elements in the role checks' setup readers

> Identified against commit `cfc82b4c98a42acdd5fbff659f22138117d4e616`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Three integration checks empty their own emulator of roles before they start (`withoutRoles` in
`tests/integration/studio/services/iam/iam.ts` and `tests/integration/studio/services/lambda/lambda.ts`, issue 653):
they remove every role a direct `ListRoles` holds and wait until a direct `ListRoles` returns none. Each helper reads
the answer as a tree and ends as an error of the environment on an answer it cannot read whole.

One hand-built answer is still taken as an empty list: a `ListRolesResult` that holds two `Roles` elements, the first
empty and the second with a member. Both readers take the first `Roles` element and never look at the second. No
emulator has been seen to answer so; the reference is the same request sent straight to aws-emulator, whose answer
holds one `Roles` element. The case leaves a Given unverified only if the emulator ever answered that way.

## Evidence

The review of issue 652's integration tests, round 5 (`review-tests-r5.md`, a source-only probe on commit `cfc82b4c`):
with this HTTP 200 body returned for both reads, each `withoutRoles` resolved after two `ListRoles` calls.

```
<ListRolesResult>
  <Roles/><Roles><member><RoleName>still-held</RoleName></member></Roles>
  <IsTruncated>false</IsTruncated>
</ListRolesResult>
```

`iam.ts`, line 537, and `lambda.ts`, line 863: the reader takes the first child named `Roles`.

## Steps to Reproduce

1. On commit `cfc82b4c`, call `withoutRoles` of either support file with the direct `ListRoles` answered by the body
   above.
2. It resolves, as for an emulator that holds no role.

## Expected

- Each `withoutRoles` ends as an error of the environment when a `ListRolesResult` holds more than one `Roles`
  element.
- The three checks that call it still pass on the machine's emulator.

## Out of scope

Any other shape of malformed answer, and the checks' own assertions.
