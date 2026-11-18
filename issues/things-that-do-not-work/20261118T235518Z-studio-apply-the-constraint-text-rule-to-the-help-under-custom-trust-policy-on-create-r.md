Issue-Id: 493
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|iam|custom-trust-policy-constraint-text-states-an-emulator-rule
Issue-Check-Ids:
Issue-Commit: 22527ebeead88cedd73d5988481ebddbc80fe005

# Apply the constraint-text rule to the help under Custom trust policy on Create role

> Identified against commit `22527ebeead88cedd73d5988481ebddbc80fe005`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On step 1 of "Create role" (`/aws/iam/roles/create`), "Custom trust policy" carries the Cloudscape constraint text
"The emulator refuses a document that is not JSON or has no statement list." `studio/references/aws-area.md`, second
list, rule 2 (#478) gives constraint text to a rule the form itself keeps. The form keeps only the first half: a
document that is not JSON gets the form's message "Enter a JSON policy document." at "Next". The second half, a
document without a statement list, is a rule only the emulator keeps. The emulator refuses `{}` at "Create role"
with `MalformedPolicyDocument` "Policy has no statements" (issue 82, requirement R2). Issue 492 moves the same kind of
help under "Service or use case" out of the constraint text into the field's description. Once 492 lands, the two
helps of step 1 sit in different places. Found by issue 492's design review (`.pm/issue-492/review-design-r1.md`, P3).

## Evidence

- `studio/src/providers/aws/area/services/iam/components/trusted-entity-step.tsx:39` (`CUSTOM_HELP`) and its
  `FormField` `constraintText` (line 163 at `22527eb`).
- `studio/src/providers/aws/area/services/iam/components/create-role-rules.ts`: the "Custom trust policy" rule is
  `isJson` only (`MESSAGES.document`).
- `.pm/archive/82/requirement.md`, R2 `CreateRole`: `{}` refused with "Policy has no statements".

## Steps to Reproduce

1. Start Studio against an emulator and open `/aws/iam/roles/create`.
2. Choose "Custom trust policy" and read the text under the field.
3. Type `{}`, then "Next", "Next", a valid name, "Create role": the form let `{}` through, and the emulator refuses it.

## Expected

- The text under "Custom trust policy" states, as constraint text, only what the form itself lets through. Help
  about what the emulator refuses is shown as the field's description, as under "Service or use case".
- `{}` at "Create role" is still refused by the emulator and shown as "Creating the role failed" with its code and
  message.

## Out of scope

- A statement-list rule in the form.
- "Service or use case" (issue 492).
