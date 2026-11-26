Issue-Id: 663
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws.service-entries.checks|transparent-label-not-read
Issue-Check-Ids:
Issue-Commit: 96e7df571557aa054452405948877d1bf41deef9

# Read a navigation link's label as unreadable when its text is painted fully transparent

> Identified against commit `96e7df571557aa054452405948877d1bf41deef9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The integration checks of issue 650 (`tests/integration/studio/aws-service-entries.spec.ts`, with the readers of
`tests/integration/studio/support/aws-entries.ts`) assert that every entry of a service's side navigation is shown.
The readers take a label as drawn when it has text rectangles inside the visible navigation, the element at the
middle of each is the link, and neither the label nor anything around it is taken out, invisible, of opacity 0 or
clipped away. A label whose text is painted fully transparent (`color: transparent`, or an alpha of 0) keeps its
rectangles, still receives the hit and has an unchanged opacity, so the checks would pass with an entry no one can
read.

No build of Studio has shown such a label; this is a gap of the checks' reader, not a fault of a screen. There is
no AWS reference: it is about how Studio's own checks read its navigation.

## Evidence

The tests review of issue 650, round 5, P2 (`.pm/issue-650/review-tests-r5.md`, kept in the issue's archive), on
`tests/integration/studio/support/aws-entries.ts`, `linksNotPainted` and the drawn-text reader (`hidden`,
`textDrawn`), at commit `96e7df57`. The decision that it is filed and does not hold the stage:
`.pm/issue-650/decisions.md`, Review decisions, "tests after r4".

## Steps to Reproduce

1. In a build of Studio, give one link of a service's side navigation `color: transparent`.
2. Run `studio.aws-entries-navigation-holds-every-entry-of-the-inventory`.
3. The check passes though the entry's label cannot be read.

## Expected

- The readers of `support/aws-entries.ts` read the computed paint of a label's text and take a fully transparent
  one as not drawn, in the navigation's links, its group names and the links under "Resource kinds".
- The checks of issue 650 pass unchanged on the present build.

## Out of scope

- A label of low contrast that can still be read (the critique's and the accessibility checks' matter).
- Any change of Studio's screens.
