Issue-Id: 29
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: worker
Issue-Key: studio|not-found.path-box|baseline
Issue-Check-Ids:
Issue-Commit: 46179fe13a6fde17ae19f33bf2011cd609cce481

# Keep the sentence of Studio's Page not found on the path box's text line

> Identified against commit `46179fe13a6fde17ae19f33bf2011cd609cce481`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On Studio's own "Page not found" (`/does-not-exist` and any other path that matches no screen), the sentence names
the path in a box, `.st-lost-path code` in `studio/src/features/not-found/not-found-page.css`. The box is an
`inline-block` that scrolls sideways (`overflow-x: auto`). Its rule's comment says it sits "on the sentence's
baseline, so its '.' follows the box's last line". But an inline-block whose `overflow` is not `visible` takes its
bottom margin edge as its baseline, not its text's. So the sentence's text after the box sits level with the box's
bottom, below the path's own line. The box rides above the line around it. In languages whose sentence goes on
after the path (Japanese, Korean, Thai, Russian), the rest of the sentence starts below the box, so the box seems to
sit in the middle of the sentence. This has been in the code since the page was built (4f995cf), so it is not
caused by issue 17.

## Evidence

- A probe of the built app (feat/17-s5 at 46179fe, `bun run build`, `bun scripts/serve.ts`, headless Chromium of
  `@playwright/test`, 390x844), at `/does-not-exist/` followed by `a-very-long-segment/` six times. Client rects in
  px, from the top of the viewport:
  - English: the box spans 173-322. The path's own text line is 181-201. The text before the box is 143-163. The "."
    after the box is 306-326, level with the box's bottom, not with the path's line.
  - Japanese (stored `ja`): the same box, 173-322, and the path line 181-201. "のページはありません。" after the box is
    330-350, below the box.
- Captures `output/captures/impl-ja/`, `impl-th/` and `impl-ru/` of the feat/17-s5 worktree, `*2-390-*`
  (`/does-not-exist` at 390): the path box sits in the middle of the sentence (rev, `.pm/issue-17/review-impl-s5-r1.md`, P3).

## Steps to Reproduce

1. Build Studio and serve it: `bun run build`, then `bun scripts/serve.ts`.
2. Open `/does-not-exist/` followed by `a-very-long-segment/` six times, 390 wide, in English and with the stored
   language `ja`.
3. Compare the client rects of the text after the path box with the rect of the path's text line inside the box.

## Expected

- At 1280 and 390, in every language, the text of the sentence on the same line as the path box shares a baseline
  with the path's text line inside the box. It never sits level with the box's bottom edge.
- The path box keeps scrolling sideways within itself, and its region keeps the catalogue's "Path" as its name.

## Out of scope

- The wording of the sentence and the place of the path in each language (issue 17's catalogues).
- The AWS area's own "Page not found".
