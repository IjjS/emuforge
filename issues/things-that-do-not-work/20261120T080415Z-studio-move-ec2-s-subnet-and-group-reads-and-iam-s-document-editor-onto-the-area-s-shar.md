Issue-Id: 590
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.shared-parts|held-twice
Issue-Check-Ids:
Issue-Commit: d7f9989b468392d4d0104ca0ea210e6e7f8e62a5

# Move EC2's subnet and group reads and IAM's document editor onto the area's shared parts

> Identified against commit `d7f9989b468392d4d0104ca0ea210e6e7f8e62a5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The AWS area holds two parts twice. Issue 575 (ECS's screens) needed the reads of subnets and of a VPC's security
groups as choices, and a field of a text document; EC2 and IAM each had one inside its own folder. By
`studio/references/aws-area.md`, point 9, a part a second service needs moves to
`studio/src/providers/aws/area/components/`. Issue 575 wrote the two parts new in the area's `components/` and left
EC2 and IAM on their own copies, since no unit of an issue that builds ECS owns EC2's or IAM's files
(`.pm/archive/575.md`, Plan decisions). The reference here is the area's own rule, not an AWS screen: nothing a
developer sees differs.

| The area's part (issue 575) | The copy still in a service's folder |
|---|---|
| `components/network-choices.ts`: `listSubnets`, `listGroups`, `subnetChoices`, `groupChoices` (`DescribeSubnets`, `DescribeSecurityGroups`), taking the `send` its caller hands it | `services/ec2/choices-api.ts`: `listSubnetChoices`, `listGroupChoices`, `SubnetChoice`, `GroupChoice`; `services/ec2/choices-queries.ts`: `subnetChoices`, `groupChoices` |
| `components/document-field.tsx`: `DocumentField`, a Cloudscape `Textarea` in a `FormField` with label, description and error text | `services/iam/components/document-editor.tsx`: `DocumentEditor`, the same |

The two are not the same in every detail, which the fixer settles: EC2's group read also filters by a typed
`group-name` and its subnet read takes no VPC; the area's subnet read takes an optional VPC and its group read a VPC
only. `DocumentField` shows its error text only while `invalid` and takes a `textareaRef`; `DocumentEditor` does
neither.

## Evidence
On `feat/575` at `d7f9989b`, from `studio/src/providers/aws/area/`:

```
$ grep -n -E "new Describe(Subnets|SecurityGroups)Command" components/network-choices.ts services/ec2/choices-api.ts
components/network-choices.ts:75:    (client, abortSignal) => client.send(new DescribeSubnetsCommand(paged(vpcId, token)), { abortSignal }),
components/network-choices.ts:104:    (client, abortSignal) => client.send(new DescribeSecurityGroupsCommand(paged(vpcId, token)), { abortSignal }),
services/ec2/choices-api.ts:182:    (client, abortSignal) => client.send(new DescribeSubnetsCommand(paged([], token)), { abortSignal }),
services/ec2/choices-api.ts:258:    (client, abortSignal) => client.send(new DescribeSecurityGroupsCommand(paged(filters, token)), { abortSignal }),

$ grep -n -E "<FormField|<Textarea" components/document-field.tsx services/iam/components/document-editor.tsx
components/document-field.tsx:38:    <FormField label={label} description={description} errorText={invalid ? errorText : undefined} stretch>
components/document-field.tsx:39:      <Textarea
services/iam/components/document-editor.tsx:32:    <FormField label={label} description={description} errorText={errorText} stretch>
services/iam/components/document-editor.tsx:33:      <Textarea
```

## Steps to Reproduce
1. Check out a commit that holds issue 575.
2. In `studio/src/providers/aws/area/`, run the two `grep` commands of Evidence: each part is found in the area's
   `components/` and again in a service's folder.

## Expected
- `DescribeSubnets` and `DescribeSecurityGroups` are sent as choices from one file of the area: the first `grep` of
  Evidence finds the two command classes constructed in `components/network-choices.ts` only.
- IAM's five screens that edit a document use the area's `DocumentField`; `services/iam/components/document-editor.tsx`
  and its test are gone.
- EC2's launch screen offers the same subnets and groups as before, the typed group-name filter included, and IAM's
  document screens show the same label, description and error text: EC2's and IAM's unit tests and their integration
  checks pass with no assertion changed.

## Out of scope
- EC2's other choices (images, instance types, VPCs, key pairs, the default VPC), which one service needs.
- ECS's screens, which already use the two parts.
- Any change a developer sees on a screen.
