Issue-Id: 620
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ecs.unit-tests|input-by-tag
Issue-Check-Ids:
Issue-Commit: 652812970d32ae871c34f109672268fa31f46f77

# Find the input of a form field in ECS's unit tests with Cloudscape's test utils

> Identified against commit `652812970d32ae871c34f109672268fa31f46f77`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Three unit tests of ECS's screens (issue 575) find the input inside a Cloudscape `FormField` with
`getElement().querySelector('input')`, a tag looked up inside a Cloudscape component. `studio/references/test-criteria.md`
asks a unit test to find what is inside a Cloudscape component with Cloudscape's test utils, so that a change of the
component's own markup does not break or blind the test. The end review of issue 575 (impl r2, P3) found it after
the round that replaced the class-name lookups of the same kind. The reference is the module's own rule, not an AWS
screen; no screen changes.

## Evidence
From the repository's root, on the commit above:

```
$ grep -n "querySelector('input')" studio/src/providers/aws/area/services/ecs/components/update-service-dialog.test.tsx studio/src/providers/aws/area/services/ecs/pages/run-task-page.test.tsx studio/src/providers/aws/area/services/ecs/pages/create-cluster-page.test.tsx
studio/src/providers/aws/area/services/ecs/components/update-service-dialog.test.tsx:115:  const input = field('Desired tasks').getElement().querySelector('input');
studio/src/providers/aws/area/services/ecs/pages/create-cluster-page.test.tsx:164:  const found = field().getElement().querySelector('input');
studio/src/providers/aws/area/services/ecs/pages/run-task-page.test.tsx:299:  const input = field(COUNT).getElement().querySelector('input');
```

## Steps to Reproduce
1. Run the `grep` command of Evidence from the repository's root: each of the three test files answers a line.

## Expected
- The three tests find the input through the form field's wrapper (`findControl()`, `findInput()`,
  `findNativeInput()`), and the `grep` of Evidence answers nothing.
- The tests' scenarios and assertions are unchanged and pass.

## Out of scope
- The same lookups in other services' tests.
- Any product file.
