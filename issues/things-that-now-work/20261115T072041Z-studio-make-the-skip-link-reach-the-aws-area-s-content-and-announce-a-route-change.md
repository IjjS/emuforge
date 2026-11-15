Issue-Id: 19
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|frame|skip-link-and-route-focus
Issue-Check-Ids: studio.skip-link-reaches-page-content studio.route-change-focuses-new-page-content studio.focus-moves-change-nothing-on-screen studio.first-load-keeps-focus-at-document-start
Issue-Commit: 12d7086aaf0eb2826b9e2dd63d84a12711adce04

# Make the skip link reach the AWS area's content and announce a route change

> Identified against commit `12d7086aaf0eb2826b9e2dd63d84a12711adce04`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Two keyboard and screen reader gaps in Studio's frame, found by the `final` critique of issue #16 (both P2, so
they did not hold that issue back):

- "Skip to content" focuses the document's `main`. Inside the AWS area that element is Cloudscape's layout
  `main`, which contains the side navigation, so the skip lands before the navigation instead of after it.
- A route change is silent. After a link is followed, focus is on `body` and nothing is announced; only the
  document title changes. This holds in Studio's own layer and in the AWS area.

Reference: none; Studio's frame is Studio's own (`studio/DESIGN.md`).

## Evidence

From issue #16's `final` critique (measured on the built app at `d40a313`, 1280x800):

- `studio/src/app/frame.tsx:44-54`: the skip link's target is `document.querySelector('main')`. On `/aws` the
  first content link takes 28 Tab presses without the skip link and 25 with it; about 24 side navigation stops
  remain after the skip.
- `studio/src/app/frame.tsx:21-28`: after Home, then "Amazon DynamoDB", `document.activeElement` is `body` and
  no live region changes.

## Steps to Reproduce

1. Build and serve Studio, open `/aws`, press Tab once and activate "Skip to content"; keep pressing Tab: the
   side navigation's links come next.
2. Open `/`, follow a service link with the keyboard: focus is on `body` afterwards, and a screen reader says
   nothing.

## Expected

- On every page the skip link moves focus to the page's own content: in a provider area, past the area's
  navigation. The area names its content target; Studio's frame does not reach into the area's markup.
- After a route change the new page is announced or receives focus (its heading or its content), in both
  layers, without stealing focus on the first load.
- Flow checks cover both.

## Out of scope

- Other findings of that critique (wording of the engine start note, the service links' touch size at 390).
