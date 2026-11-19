Issue-Id: 508
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|home-providers-list.aws-side-navigation|services-with-a-screen-not-told-apart
Issue-Check-Ids:
Issue-Commit: de458f30aa4c584c8c04c7f3f67c5f454dbf05f6

# Tell the services that have a Studio screen apart in Home's list and the AWS area's side navigation

> Identified against commit `de458f30aa4c584c8c04c7f3f67c5f454dbf05f6`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Since issues 494 and 61, Home's "Providers" section says how many services have a Studio screen ("19 services · 4
with a Studio screen"), and the AWS area's index (`/aws`) lists the services in two groups, those with a screen
first. Two lists beside them still show every service alike, so a developer cannot tell, before following a link,
which of them lead to a screen and which to a "no screen yet" page:

- Home's list of service links under the provider: nineteen links that look the same, fifteen of which lead to a
  "no screen yet" page.
- The AWS area's own side navigation (on the index and the area's own pages): the nineteen services flat, in label
  order, beside a page that groups them.

Reference: none; both are EmuForge-only parts. The area's index is the sibling that already tells them apart, from
the area's registry of screens. Found by the impeccable critique of issue 494 on the built app (two P2 findings).

## Evidence

- `.pm/issue-494/review-final.md`, P2 (crit, issue 494, `feat/494` at `80df79b`): both findings, with their
  locations.
- `studio/src/features/home/providers-section.tsx`, `ProviderEntry`: every service of `provider.services` is
  rendered as the same link, although each entry now carries `hasScreen`.
- `studio/src/providers/aws/area/area-layout.tsx`, the area's own navigation: `SERVICES.map(...)`, one flat list.
- Captures: `emuforge-494/output/captures/final-seeded/contact-sheet.png` (`/` and `/aws`, 1280 and 390, light and
  dark).

## Steps to Reproduce

1. Start Studio and the engine in front of a running emulator.
2. Open `/`: the AWS entry says some services have a Studio screen; its list of links does not show which.
3. Open `/aws`: the page groups the services by whether they have a screen; the side navigation beside it lists
   them flat.

## Expected

- On Home, the services of a provider that have a Studio screen can be told from those that have none, by text or
  structure and not by colour alone, and a screen reader hears the same.
- The AWS area's own side navigation shows the same two groups as the index, in the index's order.
- Which service has a screen is taken from the area's registry of screens (`hasScreen` outside the area, `SCREENS`
  inside it), never from a list of names written again.
- With no service having a screen, or every one, each list is one list as today.

## Out of scope

- The line on Home and the index's own page (issues 494 and 61).
- A screen's own side navigation, and the "no screen yet" page.
