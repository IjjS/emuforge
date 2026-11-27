Issue-Id: 695
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|cloudwatch-alarm-names|accessible-identity
Issue-Check-Ids:
Issue-Commit: 3637f10b8d54e7d5647207cf6f696b9b9d917436

# Tell CloudWatch alarms apart when their names differ only in white space

> Identified against commit `3637f10b8d54e7d5647207cf6f696b9b9d917436`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Two CloudWatch alarms whose names differ only in white space (`API High Latency` and `API  High Latency`, or a name
with a leading, trailing or repeated space, a tab or a line feed) are drawn apart on the alarm screens, which keep
the name's white space, and are not told apart by a screen reader: the accessible name of the list's link and of its
selection radio, of the alarm page's `h1` and of the delete dialog's heading folds the white space, so both alarms
are announced alike. A developer who hears the screens cannot tell which row is selected or which alarm a delete
confirms.

Issue 664 gave the area a treatment for this after issue 70's screens were confirmed
(`studio/references/aws-area.md`, "Names keep their white space"): `NameText` shows a name with its exact identity
in parentheses when its white space is hidden, and gives a link, heading or dialog header that identity as its
accessible name; `nameIdentity` does the same for a string that names a control. The area's crumbs, titles and
shared choice fields already use it. The alarm screens still use their own `cw/components/alarm-name.tsx`.

The `pm` let the finding stand in issue 70 (its `decisions.md`, 2026-11-27) and asked for this issue.

## Evidence
Critique final r16 of issue 70 on `feat/70` at `3637f10b` (`.pm/issue-70/review-final.md`, P2;
`emuforge-70/output/logs/crit-r16-a-names-replay.log`): with the two alarms seeded, the two list links and the two
selection radios had the same accessible name, and so had the detail `h1` (`pages/alarm-page.tsx`) and the delete
confirmation heading (`components/delete-alarm-dialog.tsx`); the list is `pages/alarm-list-page.tsx`, all under
`studio/src/providers/aws/area/services/cloudwatch/`.

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Create two metric alarms, `API High Latency` and `API  High Latency` (two spaces), with `PutMetricAlarm`.
3. Open `/aws/cloudwatch/alarms` and read the accessible names of the two name links and the two selection radios.
4. Open each alarm's page and read the accessible name of its `h1`; press "Delete" and read the dialog's heading.

## Expected
- Where an alarm screen identifies an alarm by its name (the list's link and selection control, the alarm page's and
  the edit page's name, the dialogs that name the alarm, the results that name it), two names that differ only in
  white space have different accessible names, by the area's `NameText` and `nameIdentity`.
- The stored name stays what requests, addresses, the name filter and "Copy Name" use.
- Requirement "Names" point 1 of issue 70 and the checks that assert the name character for character (the unit
  lines of the name's component and the pages; `studio.cloudwatch-alarm-names-open-by-their-address`) are changed
  with it, on the `pm`'s decision.

## Out of scope
The area's `NameText` itself and the crumbs, titles and choice fields, which issue 664 did; other services' screens.
