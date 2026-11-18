Issue-Id: 475
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.policy-text|two-rules-for-one-kind
Issue-Check-Ids:
Issue-Commit: 229e9bcc375435053f307ea77733cb731453dbbb

# Give the AWS area one preformatted element for policy text

> Identified against commit `229e9bcc375435053f307ea77733cb731453dbbb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The AWS area shows a policy document (JSON, lines wider than a phone screen) on two screens, and the two follow two
different rules, because the area has no element of its own for preformatted policy text:

- IAM's "Create role", step 3, shows the trust policy in `.aws-area-policy-text`
  (`studio/src/providers/aws/area/services/iam/components/create-role.css`): `white-space: pre-wrap;
  overflow-wrap: anywhere`, so a long line breaks inside its box, anywhere in a word.
- SQS's queue page (issue 79, requirement R5.3, `decisions-needed.md` question 9, option a) shows a queue's
  "Access policy" unbroken in an element of `services/sqs/` that scrolls sideways inside itself
  (`overflow-x: auto`, a region named "Access policy" reached with Tab), since the confirmed case of
  `components/value-text.test.tsx` allows no stylesheet under `services/` to break words but IAM's rule.

So one kind of value, a policy document, reads differently from one service to the next, and a further service
that shows a policy (S3 bucket policy, KMS key policy, SNS topic policy, Lambda resource policy) has to pick one
of the two or add a third. `studio/AGENTS.md`, "What every AWS screen does", rule 4 gives every value a kind and a
way to break; a preformatted policy has no shared part in `providers/aws/area/components/` as names, addresses and
free text have in `value-text.tsx`.

## Evidence

- `studio/src/providers/aws/area/services/iam/components/create-role.css` lines 1 to 7: the rule
  `.aws-area-policy-text { white-space: pre-wrap; overflow-wrap: anywhere; }`, used by
  `services/iam/components/review-step.tsx` line 109.
- `studio/src/providers/aws/area/components/value-text.test.tsx` line 169: the case "every stylesheet under
  services/, read from disk: none declares `overflow-wrap` or `word-break`, but for the rule of
  `.aws-area-policy-text`", which expects exactly IAM's one rule.
- `.pm/issue-79/requirement.md` R5.3 ("Access policy") and `.pm/issue-79/decisions-needed.md` question 9: SQS's
  access policy is kept unbroken in its own element that scrolls sideways inside itself, so that no confirmed case
  changes and no shared path is touched. Once issue 79 is on `main`, its element is in
  `studio/src/providers/aws/area/services/sqs/` and the check `studio.sqs-values-break-where-they-can-be-read`
  asserts the scrolling.

## Steps to Reproduce

1. With issue 79 on `main`, make a queue with an access policy whose `Resource` is its ARN, open its page at 390
   wide: the policy's lines are unbroken and the region "Access policy" scrolls sideways.
2. Open "Create role" at 390 wide, go to step 3 with a trust policy whose line is wider than the box: the line
   breaks inside the box.
3. Read `components/value-text.test.tsx` line 169: the area allows IAM's rule alone.

## Expected

- The AWS area has one element in `providers/aws/area/components/` for preformatted policy text, with one rule for
  a line wider than its box; IAM's trust policy and SQS's access policy both use it, and neither service keeps a
  stylesheet rule of its own for it.
- On both screens, at 1280 and 390 wide, the page does not scroll sideways and the policy's text, selected and
  copied, equals the document as shown.
- The case of `components/value-text.test.tsx` holds that no stylesheet under `services/` declares `overflow-wrap`
  or `word-break`, with no exception.

## Out of scope

- Which of the two rules the element follows (break or scroll): the plan of this issue decides it from the
  references.
- Editing a policy (issues #374 and the IAM edit issues), and any service that shows no policy today.
