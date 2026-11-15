Issue-Id: 38
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|frame.bar|grow-within-fallback-not-built
Issue-Check-Ids:
Issue-Commit: b95490c2b2d499aa6352ad6f51d082f5afbcfce4

# Build the bar's fallback for a tab list that does not fit, or correct DESIGN.md's Grow Within Rule

> Identified against commit `b95490c2b2d499aa6352ad6f51d082f5afbcfce4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`studio/DESIGN.md`, The Grow Within Rule, says that when the tab list does not fit the bar, "Studio" leaves the bar
(staying in the link's accessible name), the bar's right padding goes, and the list's overflowing edge fades over
its last 24px so a tab beyond it reads as more to scroll to. Studio's bar does only the first half of the rule: the
tab list scrolls within the bar. "Studio" stays, the padding stays, and no edge fades, so a tab cut by the list's
edge gives no sign that the list scrolls. The reference is Studio's own design guide; no AWS screen is involved.

Found while planning issue #36, which adds the tile to the wordmark and takes "Studio" out of the bar at 640px and
below for a different reason (the bar's width in twelve languages); #36 leaves this fallback as it is.

## Evidence
- `studio/DESIGN.md:453-455`: the rule's text.
- `studio/src/ui/bar.css`: `.st-nav` has `overflow-x: auto` and a hidden scrollbar; no rule in `studio/src/ui/`
  or `studio/src/app/frame.tsx` hides "Studio" by the list's fit, removes the bar's right padding, or masks the
  list's edge (`grep -n "mask\|fade" studio/src/ui/*.css studio/src/app/frame.tsx` prints nothing).
- `.pm/issue-36/mocks/states.html`, the bar "When the tab list does not fit" (700px wide, six tabs), drawn with the
  bar's rules as they are on `main`: the last tab is cut with no fade, and "Studio" is still drawn.

## Steps to Reproduce
1. Build and serve Studio; open `/` at 1280 wide.
2. With developer tools, add four more links to the bar's `nav` (Studio has one provider today, so the state is
   not reachable by use), or narrow the window until the tab list is narrower than its content.
3. Look at the wordmark and at the tab list's right edge.

## Expected
- Either: when the tab list's content is wider than the list, "Studio" is not drawn in the bar while the link's
  accessible name stays "EmuForge Studio", and the list's overflowing edge fades over its last 24px; when the list
  fits again, both return.
- Or: `studio/DESIGN.md`'s Grow Within Rule says what the bar does (the list scrolls within the bar) and no more.
- Either way the rule's text and the bar agree, and a check holds the chosen behavior.

## Out of scope
- The 640px form of the wordmark and the tile (issue #36).
- Adding providers.
