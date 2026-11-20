Issue-Id: 590
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.shared-parts|held-twice
Issue-Check-Ids:
Issue-Commit: d7f9989b468392d4d0104ca0ea210e6e7f8e62a5

# Move IAM's document editor onto the area's document field

> Identified against commit `d7f9989b468392d4d0104ca0ea210e6e7f8e62a5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The AWS area holds one part twice. Issue 575 (ECS's screens) needed a field of a text document and wrote it in the
area's `components/` (`document-field.tsx`), since IAM had the same inside its own folder
(`services/iam/components/document-editor.tsx`) and, by `studio/references/aws-area.md`, point 9, a part a second
service needs moves to `studio/src/providers/aws/area/components/`. IAM was left on its own copy, since no unit of an
issue that builds ECS owns IAM's files. The reference is the area's own rule, not an AWS screen: nothing a developer
sees differs.

| The area's part (issue 575) | The copy still in a service's folder |
|---|---|
| `components/document-field.tsx`: `DocumentField`, a Cloudscape `Textarea` in a `FormField` with label, description and error text | `services/iam/components/document-editor.tsx`: `DocumentEditor`, the same |

The two are not the same in every detail, which the fixer settles: `DocumentField` shows its error text only while
`invalid` and takes a `textareaRef`; `DocumentEditor` does neither.

When this issue was filed it also named EC2's subnet and security group reads, held beside a copy issue 575 had
written. Issue 574 has since lifted those reads into the area (`lib/ec2-network-choices.ts`,
`components/security-group-choices.ts`, `lib/ec2-client.ts`), and issue 575 uses them and removed its copy before it
merged: that half is done and is no part of this issue.

## Evidence
On `feat/575` at `d7f9989b`, from `studio/src/providers/aws/area/`:

```
$ grep -n -E "<FormField|<Textarea" components/document-field.tsx services/iam/components/document-editor.tsx
components/document-field.tsx:38:    <FormField label={label} description={description} errorText={invalid ? errorText : undefined} stretch>
components/document-field.tsx:39:      <Textarea
services/iam/components/document-editor.tsx:32:    <FormField label={label} description={description} errorText={errorText} stretch>
services/iam/components/document-editor.tsx:33:      <Textarea
```

## Steps to Reproduce
1. Check out a commit that holds issue 575.
2. In `studio/src/providers/aws/area/`, run the `grep` command of Evidence: the field is found in the area's
   `components/` and again in IAM's folder.

## Expected
- IAM's five screens that edit a document use the area's `DocumentField`; `services/iam/components/document-editor.tsx`
  and its test are gone.
- IAM's document screens show the same label, description and error text as before: IAM's unit tests and its
  integration checks pass with no assertion changed.

## Out of scope
- A code editor for the field (issue 618).
- ECS's screens, which already use the area's field.
- Any change a developer sees on a screen.
