Issue-Id: 694
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|apigateway.rest-stages|invoke-url-offscreen-at-390
Issue-Check-Ids:
Issue-Commit: f40fadf3bac611e54b7eecc5e9949a13ffd68168

# Keep a REST stage's name beside its invoke URL at 390 wide

> Identified against commit `f40fadf3bac611e54b7eecc5e9949a13ffd68168`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On the REST API page (`/aws/apigateway/apis/rest/{api_id}`), the table "Stages" has the columns stage name,
"Deployment ID", "Last change" and "Invoke URL", in that order. At 390 wide the table scrolls inside itself, and
"Invoke URL" with its copy control starts outside the visible part. Scrolling the table to it moves the stage names
out of view, so a developer who wants the address of one stage can tell the rows apart only by the end of each
URL. The reference is the impeccable critique of the built app (`studio/references/critique.md`), which found this
as a P2 in issue 691. The column order is issue 69's; issue 691 changed where the address comes from and nothing
of the layout, and the `pm` let the P2 stand there because moving the column changes confirmed checks that read
the row's cells by position.

## Evidence

`.pm/issue-691/review-final.md` (archived with issue 691), P2 at
`studio/src/providers/aws/area/services/apigateway/components/rest-stages.tsx:111`; score row "final-REST API
Stages" 31/40, P2 1 in `.pm/issue-691/critique-scores.json`. Captures of that critique at 390 wide, light and dark:
`emuforge-691/output/captures/final/`. The decision to leave it: `.pm/issue-691/decisions.md`, Review decisions.

## Steps to Reproduce

1. On a fresh emulator create a REST API with a method and deploy it to two stages, `dev` and `prod`.
2. Open `/aws/apigateway/apis/rest/<api id>` in Studio at 390 wide and go to "Stages".
3. Scroll the table sideways until "Invoke URL" and its copy control are in view.

## Expected

- At 390 wide a developer can see which stage an invoke URL and its copy control belong to without scrolling the
  stage's name out of view: in the row, the stage's name and its "Invoke URL" with the copy control are visible
  together.
- At 1280 wide the table shows the same four values per stage, and copying the address works as before.
- The page does not scroll sideways at 390 or 1280 (`studio/references/aws-area.md`, "What earlier critiques
  found", entry 4).
- The checks that read a stage row's cells (`apigateway-rest-api.spec.ts`, `apigateway-rest-build.spec.ts`) follow
  the new place of each value on the `pm`'s decision and still pass.

## Out of scope

Where the address comes from (issue 691). The "Stages" table of an HTTP API (`v2-stages.tsx`), unless the critique
of this change finds the same there.
