Issue-Id: 501
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area-focus|line-under-sticky-bars
Issue-Check-Ids:
Issue-Commit: bc333b2ae909fd74890a310cda64b4edc74fd640

# Keep the AWS area's emulator line in view when a route change focuses the page at 390

> Identified against commit `bc333b2ae909fd74890a310cda64b4edc74fd640`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On a phone-width window (390 px) a route change inside the AWS area moves focus to the page's content target with a
plain `.focus()` (`studio/src/providers/aws/area/area-layout.tsx`, the content-target focus), and the browser scrolls
it into view under the sticky top bar and the area's mobile toolbar, so the emulator line (label, status, target) ends
up hidden under them. It predates issue 486: a Back route change does it too. Found by the impeccable critique of
issue 486, round 2 (`.pm/issue-486/review-final.md`, graded P2, "Graded down in synthesis").

## Evidence

- `.pm/issue-486/review-final.md` (issue 486, crit round 2): at 390 on S3's bucket list, after a route change with focus
  inside the page, scrollY 59 and the line's label under the mobile toolbar; the same on a Back route change on the
  same build (feat/486 at 0ed726e).
- `studio/src/providers/aws/area/area-layout.tsx` on `main`: `target.current?.focus();` with no `preventScroll` and no
  scroll that clears the sticky chrome.

## Steps to Reproduce

1. Open Studio at 390 x 844 with an emulator running; open `/aws/s3/buckets`.
2. Follow a link to another area route, then go Back.
3. The page is scrolled so the emulator line sits under the sticky bars.

## Expected

After a route change the emulator line is visible at every width checked, while focus is on the page's content target.

## Out of scope

The line's content and the flash (issue 486); the top bar's layout.
