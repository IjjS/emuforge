Issue-Id: 479
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: worker
Issue-Key: studio|guides|structure-score-leftovers
Issue-Check-Ids:
Issue-Commit: 1ab84b8ad52fc28848c58fc3f31d652d61d5ee67

# Remove what the structure score left in studio/PRODUCT.md, the seed scripts and the product comments

> Identified against commit `1ab84b8ad52fc28848c58fc3f31d652d61d5ee67`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 478 removed the structure score, the reference specs (`studio/references/console/`,
`console-reference.md`) and the rule that the AWS area follows the console's structure, and moved the sections of
`studio/AGENTS.md` that a single piece of work needs into `studio/references/` (`aws-area.md`, `own-layer.md`,
`languages.md`). Issue 478's scope rule kept product files out of its harness change, so three kinds of leftover
remain outside the harness: product context that still states the old rule, seed scripts of a score nobody runs, and
code comments that cite files or sections that no longer exist.

## Evidence

- `studio/PRODUCT.md` lines 25, 64-69, 78: the AWS area "follows the AWS console's structure and flow" and points to
  `studio/AGENTS.md`, "AWS screen policy"; that section is now `studio/references/aws-area.md`, and the policy no
  longer asks the console's structure (owner, 2026-11-18, issue 478 `decisions.md`: "ui나 규격, 구조는 실제와 같으면
  안되고 약간 다른 기능이 들어가거나 해도 좋아"). Lines 92 and 134 read the same way.
- `tests/integration/studio/services/{s3,iam,lambda}/*-seed-structure.ts`: the seed scripts of the structure score;
  no check and no harness script runs them now that `pm-structure` is gone. `.pm/bin/tests/test_service_tree.py`
  (`test_support_holds_no_service_file_and_each_folder_its_own`, about line 145) asserts they exist, and
  `tests/integration/README.md` lines 84-89 ("A service's folder") describe them.
- Comments citing `studio/references/console/*.yaml` (deleted): s3 `create-bucket-page.tsx:48`,
  `delete-bucket-page.tsx:30-31`, `empty-bucket-page.tsx:31-32`; lambda `function-list-page.tsx:31`,
  `function-page.tsx:27`, `create-function-page.tsx:30`, `components/function-sections.tsx:14`.
- Comments citing `studio/AGENTS.md` sections that moved to `studio/references/`: area `value-text.tsx:6`,
  `copy-value.tsx:7`, `discard-dialog.tsx:9`, `value-text.css:2`; s3 `bucket-read.ts:46`,
  `bucket-name-confirmation.tsx:7`, `bucket-list-page.tsx:68`; iam `failures.tsx:14`; lambda `failure-states.tsx:16`;
  tests `iam/role-list-page.test.tsx:305`, `iam/delete-roles-dialog.test.tsx:230`; integration
  `lambda-function-screens-safety.spec.ts:3`, `services/s3/s3.ts:100`, `services/lambda/lambda-list.ts:87`.
  Full list: `grep -rn 'studio/AGENTS.md\|references/console' studio/src tests/integration`.

## Steps to Reproduce

1. `grep -rn 'studio/AGENTS.md\|references/console\|seed-structure\|structure score' studio tests/integration`
   on `main` after issue 478.
2. Open each hit and compare it with `studio/AGENTS.md` and `studio/references/` as they are now.

## Expected

- `studio/PRODUCT.md` states the AWS area as `studio/references/aws-area.md` does (what the emulator's API
  supports, as the tasks a developer does locally; the console a reference for UX, not a structure to match) and
  points to that file.
- The three seed scripts are deleted, with `test_service_tree.py`'s assertion on them and the README passage.
- Each comment names the file and section that now holds the rule, or no longer cites a deleted spec.
- `studio/src/test/request-module.test.ts` and `brand-files.test.ts`, which pin text of `studio/AGENTS.md`, still
  pass; the text they pin stays where it is unless the test is changed with it.

## Out of scope

- Any change to screen behaviour or layout.
- The harness guides and references, changed by issue 478.
