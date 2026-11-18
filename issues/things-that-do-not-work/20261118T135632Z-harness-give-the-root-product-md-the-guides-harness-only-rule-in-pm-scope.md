Issue-Id: 487
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: gap
Issue-Source: worker
Issue-Key: harness|pm-scope|root-product-guide-rule
Issue-Check-Ids:
Issue-Commit: ff6508ca72d483d012e98e68923c6d42cba71522

# Give the root PRODUCT.md the guides' harness-only rule in pm-scope

> Identified against commit `ff6508ca72d483d012e98e68923c6d42cba71522`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 483 adds the root `PRODUCT.md`, the owner's product plan. No rule of `RULES` in `.pm/bin/_pmscope.py` matches
it, so `pm-scope` treats it as an unknown path and every later change of it calls for every module's checks, every
service's browser checks included, although no product step reads it. Only the harness test
`.pm/bin/tests/test_product_docs.py` reads it. The pm's answer to Q3 of issue 483's plan left the rule to this issue.

## Evidence

`.pm/bin/_pmscope.py`, `RULES`: the guides' rule lists `AGENTS.md`, `engine/AGENTS.md`, `tests/integration/AGENTS.md`
and the modules' `references/`, not `PRODUCT.md`; `.pm/bin/tests/test_scope.py`,
`test_unknown_path_calls_for_every_module_and_is_named`, shows an unknown path calls for every module.

## Steps to Reproduce

On a branch whose only change is the root `PRODUCT.md`, ask `pm-scope` what it calls for: every module.

## Expected

A change of the root `PRODUCT.md` alone calls for the harness tests only, like the other guides a harness test reads,
with a case in `test_scope.py`.

## Out of scope

The rules of `README.md` and `studio/PRODUCT.md`, which product steps read.
