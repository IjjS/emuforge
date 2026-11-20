Issue-Id: 558
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area-token-listing-and-paged-choices|duplication
Issue-Check-Ids:
Issue-Commit: 93fe3f307567336a864124fe43903cd3df7182c4

# Move s3, iam, sns and sqs onto the area's token listing and paged choices

> Identified against commit `93fe3f307567336a864124fe43903cd3df7182c4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 553 (EC2) added the token listing and the paged choices as parts of the AWS area that name no service:
`studio/src/providers/aws/area/components/use-token-listing.ts`, `use-paged-choices.ts`, `choice-select.tsx` and
`choice-multiselect.tsx`. The services built before it each keep a copy of their own of the same behavior: a list
read a page at a time by the emulator's token, and a form's choices read a page at a time with "Load more". Only
EC2 uses the area's parts; a fault fixed in one copy stays in the others. The reference is the area's own layer
(`studio/references/aws-area.md`): a part a second service needs lives in the area, once.

## Evidence

At commit `93fe3f307567336a864124fe43903cd3df7182c4`, under `studio/src/providers/aws/area/`:

- `services/sns/queries.ts:99` `export interface Listing<T>` and `:327` `export interface Choices<T>`, with their
  hooks; `services/sns/components/endpoint-select.tsx` is a paged select of its own.
- `services/iam/queries.ts:77` `export interface Listing<T>`, with its hook.
- `services/sqs/queries.ts` and `services/s3/queries.ts` page by token in code of their own (11 and 10 lines that
  name a token or a page; `grep -nE "NextToken|ContinuationToken|nextToken|goToPage|loadMore"`).
- `components/use-token-listing.ts:114` `useTokenListing` and `components/use-paged-choices.ts:91`
  `usePagedChoices` are imported by `services/ec2/` alone.

## Steps to Reproduce

1. `grep -rnE "interface (Listing|Choices)<" studio/src/providers/aws/area/services` lists the copies.
2. `grep -rn "use-token-listing\|use-paged-choices\|choice-select" studio/src/providers/aws/area/services` names
   only files of `services/ec2/`.

## Expected

- The token-paged lists of s3, iam, sns and sqs are read through the area's `useTokenListing`, and their paged
  choice fields through `usePagedChoices` and `ChoiceSelect`; no service keeps a `Listing<T>` or `Choices<T>` of
  its own.
- Every unit test and every browser check of those services passes unchanged: no screen reads or behaves
  differently.

## Out of scope

- DynamoDB's item pages (a scan's `LastEvaluatedKey`, not a token list of resources).
- Any change of what a screen shows.
