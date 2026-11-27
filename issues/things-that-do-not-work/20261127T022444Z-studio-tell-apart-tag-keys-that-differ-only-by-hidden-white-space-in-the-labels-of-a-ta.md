Issue-Id: 682
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|tag-keys-with-repeated-spaces|labels
Issue-Check-Ids:
Issue-Commit: 1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f

# Tell apart tag keys that differ only by hidden white space in the labels of a tag row's controls

> Identified against commit `1e50de9d7c26c7c5a2cdeb31cf95c318235b4d3f`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The emulator lets a tag's key hold two spaces in a row, so one resource can carry the tags `p664 a b` and
`p664 a  b` (one space against two). A tag row of the AWS area has controls of its own, "Edit tag {key}" and
"Remove tag {key}", whose labels are written from the key as it is. A browser collapses the white space of an
accessible name, so both rows' controls are announced with the same name: a user of assistive technology cannot tell
which tag a control edits or removes. What is sent to the emulator is exact; only the label is ambiguous.

The reference is the area's rule for a resource's name, made by issue 664: where rendering would hide a difference
of white space, the name's exact identity (`nameIdentity` of the area, in which a hidden space is written
`\u0020`) is what a control's label holds. Issue 664 applies it to resource names; a tag's key is not one, and its
rows are in the tag parts of eight files of six services (`ssm/components/tags/tags.tsx`,
`secretsmanager/pages/secret-page.tsx` and `components/lifecycle/lifecycle-dialog.tsx`,
`kms/components/labels/tags.tsx`, `sns/components/topic-settings.tsx` and `pages/topic-page.tsx`,
`logs/components/manage-tags-dialog.tsx` and `pages/create-log-group-page.tsx`) and in the area's tags field that
issue 651 adds.

## Evidence

Found by the plan of issue 664 on the built app of `main` at `1e50de9d`, against aws-emulator 1.0.633, 2026-11-27.
The emulator's answers (`CreateSecret` with the two tags, then `DescribeSecret`):

```
CreateSecret with tags	200	"ok"
DescribeSecret	200	["p664 a b","p664 a  b"]
```

The same two keys were accepted and returned by S3 (`PutBucketTagging`), SQS (`TagQueue`), CloudWatch Logs
(`TagLogGroup`), IAM (`TagRole`), Systems Manager (`PutParameter` with tags), KMS (`CreateKey` with tags), Lambda
(`CreateFunction` with tags), SNS (`TagResource`) and EC2 (`CreateTags`).

The accessible names Chromium computes on `/aws/secretsmanager/secrets/detail?name=p664-secret` (its accessibility
tree, read over the DevTools protocol) for the row of the key with two spaces:

```
rowheader "p664 a b"
cell "Edit tag p664 a b Remove tag p664 a b"
button "Edit tag p664 a b"
button "Remove tag p664 a b"
```

while the buttons' `aria-label` attributes hold `Edit tag p664 a  b` and `Remove tag p664 a  b`.

## Steps to Reproduce

1. On the emulator, create a secret `p664-secret` with the tags `p664 a b` and `p664 a  b` (two spaces), each
   with the value `v`.
2. Open `/aws/secretsmanager/secrets/detail?name=p664-secret` in Studio.
3. Read the accessible names of the two tag rows' "Edit tag" and "Remove tag" buttons.

## Expected

- The controls of two tag rows whose keys differ only by white space a browser collapses (two or more spaces in a
  row, a leading or trailing space, a tab, a line break) have different accessible names, each holding its key's
  exact identity as the area writes it.
- The same holds on every screen of the area that has a control named by a tag's key.
- What is sent to the emulator for a tag is unchanged.

## Out of scope

- How a tag's key is drawn as text: the area's value element keeps its white space since issue 664.
- A tag's value.
