Issue-Id: 64
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|aws-area.tooltip|unstyled-outside-area
Issue-Check-Ids:
Issue-Commit: b9338dbaeebb53eb3f0d38bdff244db0d75b4218

# Style Cloudscape tooltips that open outside the AWS area

> Identified against commit `b9338dbaeebb53eb3f0d38bdff244db0d75b4218`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Cloudscape renders the tooltip of a disabled button (the `disabledReason` text, for example "Select a bucket
first" on the S3 bucket list's Empty and Delete buttons) through a portal appended to `document.body`. The
Cloudscape theme tokens and base styles of the AWS area are scoped to `:where(.aws-area)`, so the tooltip sits
outside that scope and renders without the AWS console's colors, font and spacing. In the AWS console the same
tooltip is drawn with the console theme.

## Evidence
- `studio/node_modules/@cloudscape-design/components/internal/components/tooltip/index.js:34`: the tooltip is
  wrapped in `Portal`, which mounts into `document.body`.
- `studio/src/providers/aws/area/styles/base-theme-root.css:8` and
  `studio/src/providers/aws/area/styles/index-base.scoped.css:8`: the theme and base styles apply only under
  `:where(.aws-area)`.
- `studio/src/providers/aws/area/services/s3/pages/bucket-list-page.tsx`: Empty and Delete pass
  `disabledReason`, so the tooltip opens on hover or focus while no bucket is selected.

## Steps to Reproduce
1. Start the emulator and the engine, build and serve Studio.
2. Open `/aws/s3/buckets` with at least one bucket and nothing selected.
3. Hover or focus the disabled Delete button.
4. Inspect the tooltip element: it is a child of `body`, not of `.aws-area`, and its computed font and colors
   are not the area's theme values.

## Expected
- A Cloudscape tooltip, popover or other portalled element opened from the AWS area is drawn with the same
  theme tokens as the area (font family, text and background colors match an element inside `.aws-area`).
- No Cloudscape style leaks onto Studio pages outside the AWS area.

## Out of scope
- The wording of any disabled reason.
- Dropdowns and modals other than those Cloudscape portals out of the area, unless they share the cause.
