Issue-Id: 36
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|brand|logo-assets
Issue-Check-Ids:
Issue-Commit: 736ba89ac0a09ccd44cba108edf2746e837e5639

# Give EmuForge its logo: draw the brand marks as real assets and use them in Studio

> Identified against commit `736ba89ac0a09ccd44cba108edf2746e837e5639`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

EmuForge has no logo. Studio's frame shows the name as text, the browser tab has no icon, and the repository
has no mark. The owner has brought a brand sheet, but it is a reference only: one raster image (1774 x 887)
showing every mark side by side, with soft edges, not files that can be used. The marks have to be drawn as
real assets (vector where a mark is a shape, raster where a size is fixed) and then applied.

What the sheet shows (the owner's reference; kept outside git at
`.initial-refs/brand/reference-sheet-20261116.png` in the main checkout, never committed):

- **Symbol**: the head and neck of an emu in profile, facing right, with a crest of feathers and an almond eye,
  in one flat colour.
- **Logo, primary**: the symbol in light on a teal rounded square, then "EmuForge" in a dark bold sans with
  "STUDIO" under it in teal, letter-spaced capitals. On a dark ground: the square is light teal with the symbol
  dark, "EmuForge" white, "STUDIO" light teal.
- **Logo, compact**: the same square and "EmuForge" alone, light and dark.
- **App icon and favicon**: the symbol with a `</>` sign at the lower right, on three grounds: teal (symbol
  light), cream (symbol teal) and near-black (symbol light teal).
- **Symbol standalone**: the emu alone in teal.
- **Social image, 1200 x 630**: the primary logo, the line "Your free, local cloud workspace", and an
  illustration of stacked windows with a code sign and a checklist, on a cream ground with teal bands.

The sheet's colours are close to Studio's own tokens (`studio/DESIGN.md`: accent `oklch(0.47 0.085 187)`, the
warm light ground, the near-black dark ground). The assets use the tokens, not colours sampled from the image.

Open points for the requirement stage:

- The owner's sheet becomes a brand commitment. `studio/PRODUCT.md` says today that only the names are binding
  and that no logo exists; it changes with this issue. Which parts are binding (the symbol, the lock-ups, the
  line "Your free, local cloud workspace") is the owner's to confirm, in one bundled question.
- Tracing a raster by hand or by tool gives an approximation. The plan says how each mark is drawn and how
  closeness to the sheet is judged; the owner does not approve drawings (root `AGENTS.md`), so the judgement
  is a stated comparison, not taste.
- The wordmark's face: the sheet's letters resemble a geometric sans; Studio's wordmark is pinned to
  Instrument Sans (`studio/DESIGN.md`). Whether the logo's text is live text in Studio's face or outlines drawn
  after the sheet.
- Where assets live (`studio/` for what the app serves; a place for the repository's own use such as the
  README) and which formats: SVG for the symbol and lock-ups, an `.ico` and PNG sizes for the favicon and app
  icons, a PNG for the social image.

Order: independent of other open issues. The README's own use of the logo can follow issue #34, which rewrites
the README.

Reference: the owner's sheet, for the marks. No console reference; this is Studio's own layer.

## Evidence

```
$ ls studio/public
ls: studio/public: No such file or directory
$ grep -n "icon\|<title" studio/index.html
6:    <title>EmuForge Studio</title>
$ grep -n "st-wordmark" studio/src/app/frame.tsx
117:        <Link className="st-wordmark" to="/">
$ sed -n '/^## Brand Commitments/,/^## Evidence/p' studio/PRODUCT.md
## Brand Commitments

The names "EmuForge" and "EmuForge Studio" are binding. No logo, colour or voice is binding.
```

## Steps to Reproduce

1. Build and serve Studio and open `/`: the browser tab shows no icon, and the frame's wordmark is text alone.
2. Look for a logo file in the repository: there is none.

## Expected

- The symbol, the primary and compact logos (for light and dark grounds), the app icon and favicon variants and
  the social image exist as files in the repository, drawn cleanly (vector shapes with no raster inside for the
  symbol and logos), in Studio's token colours, each named for what it is.
- Studio uses them: the browser tab shows the favicon in light and dark schemes, and the frame shows the symbol
  with the wordmark, at 1280 and 390, without breaking the frame in any of the twelve languages.
- The assets are served from Studio's own origin; nothing is fetched from elsewhere.
- Each mark is recognisably the sheet's: the comparison the requirement defines passes for every mark.
- Studio's own screens keep their critique pass with the logo in the frame.
- `studio/PRODUCT.md` (Brand Commitments, Evidence on Hand) and `studio/DESIGN.md` say what the logo is, where
  the files are, the clear space and smallest size, and which variant goes on which ground.
- The reference sheet itself is not committed.

## Out of scope

- A new illustration style or marketing pages; the social image is the one on the sheet.
- The README's layout (issue #34); it may show the logo once the files exist.
- Package or installer icons (issue #35).
