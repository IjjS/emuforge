Issue-Id: 662
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws.service-navigation|current-entry-below-the-fold
Issue-Check-Ids:
Issue-Commit: 1b8f1dde5973593298a2c971de73c63a4b711a8b

# Show the current entry of a service's side navigation when it lies below the fold on a direct load

> Identified against commit `1b8f1dde5973593298a2c971de73c63a4b711a8b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 650 gives every service's side navigation an entry for each sub-service and resource kind. In a long
navigation (VPC has 68 entries, gathered in ranges that open and close) a direct load of an entry's address opens
the range of the current entry and marks the entry current, but the navigation is not scrolled, so the current
entry can lie below the visible part of the side navigation and the developer does not see where they are.

There is no AWS reference for this: it is the behavior of Studio's own navigation (issue 650, requirement R4.6: the
current entry's group is open).

## Evidence

The critique of issue 650, second `final` point, P3 (`.pm/issue-650/review-final.md`, kept in the issue's archive):
at 1280 x 800, a direct load of `/aws/vpc/vpn-gateways` opens range V and marks "VPN gateways" current, and its row
starts at about y = 912, below the fold of the side navigation. Captures of that point:
`emuforge-650/output/captures/final-r2/` (the worktree of issue 650).

## Steps to Reproduce

1. Start Studio against a fresh emulator, with a window of 1280 x 800.
2. Open `/aws/vpc/vpn-gateways` directly.
3. Look at the side navigation without scrolling it.

## Expected

- After a direct load of an entry's address, the current link of the side navigation is inside the visible part of
  the navigation.
- Focus is where a route change of the area puts it (the content target), and the navigation can still be scrolled
  by hand.

## Out of scope

- The order, grouping or text of the entries (issue 650).
- A route change inside the area made by following a link of the navigation, where the link is already in view.
