Issue-Id: 47
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: feature
Issue-Source: plan
Issue-Key: harness|reference-spec|navigation-and-badge-items
Issue-Check-Ids:
Issue-Commit: 4b06a3ecaf21707af1e395d8988e6902df0e2f9a

# Give a reference spec items for side navigation entries and badges

> Identified against commit `4b06a3ecaf21707af1e395d8988e6902df0e2f9a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A reference spec (`studio/references/console-reference.md`) lists a console screen's breadcrumbs, title, actions,
table controls and columns, tabs, sections, fields and wizard steps. It has no item for an entry of the side
navigation or for a badge. Under the AWS screen policy (issue #45, point 4) those are among the parts a screen
leaves off when the emulator does not have them: the S3 bucket list sample leaves out four navigation sections
and two navigation links of the console. Because a spec cannot name them, they cannot be recorded as left out
(issue #46 marks only items a spec has), and a screen that shows a navigation entry for something the emulator
lacks is not caught: the structure score's `extra` list takes only buttons, column headers, tabs and field
labels inside `main`, and skips everything inside a navigation.

Found while planning issue #46. Reference: the method in `studio/references/console-reference.md`.

## Evidence

```
$ grep -n "^TOP_KEYS" -A1 .pm/bin/_pmspec.py
25:TOP_KEYS = ("screen", "service", "kind", "route", "breadcrumbs", "header", "table", "tabs", "sections", "steps",
26:            "submit", "omitted")
$ grep -n "^EXTRA_ROLES\|not n.in_navigation" .pm/bin/_pmscore.py
26:EXTRA_ROLES = ("button", "columnheader", "tab", "LabelText", "term")
419:                    and not n.in_navigation and key not in claimed and key not in seen):
```

`.initial-refs/policy/aws-screen-sample-review-r2.md` (main checkout, outside git), section 2, rows 11 to 17: the
console's navigation sections "Files", "Access management and security", "Storage management and insights" and
the links "Account and organization settings" and "AWS Marketplace for S3" are absent from sample B on purpose.

## Steps to Reproduce

1. Write a spec for the S3 bucket list and try to list the console's navigation section "Access management and
   security": no key of the format holds it (`spec <path>: unknown key navigation`).
2. Score a page whose side navigation has a link "Access Points" against any spec: the link is in no group of
   the report.

## Expected

- A spec can list the entries of the screen's side navigation, in order, and an entry can be marked as left out
  as any other item (issue #46's rules).
- A navigation entry the spec marks as left out fails the run when the screen shows it.
- The guide says whether a badge is an item, and if it is, how it is matched.

## Out of scope

- The mark itself and its rules: issue #46.
- The side navigation of the AWS area as built: issue #45 and the service screens.
