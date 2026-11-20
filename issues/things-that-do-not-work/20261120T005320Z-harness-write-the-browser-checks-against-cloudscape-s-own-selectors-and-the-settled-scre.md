Issue-Id: 556
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|checks|cloudscape-selectors-and-settled-state
Issue-Check-Ids:
Issue-Commit: 1dbfb37243dc07b320f1cc22733f10079c2c8225

# Write the browser checks against Cloudscape's own selectors and the settled screen

> Identified against commit `1dbfb37243dc07b320f1cc22733f10079c2c8225`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-20, on why checks fail by the machine's timing while the product is right ("기계에 따른 타이밍이
테스트를 실패하게 한다.. 테스트 조건 등에 문제 있는건 아냐?", "컴포넌트 같은거로 확인해야하는거 아냐?", "아나 진작에 그렇게
해야지").

Of the four timing faults the run on GitHub Actions showed on 2026-11-19 and 20, three were the tests' own (issue 551:
a heading asked for as exactly "Topics" while Cloudscape draws the counter inside it once the list is read; a select's
option filtered by its whole text while Cloudscape writes the label twice into a highlighted option; issue 533: an
engine test that read the log as soon as a port accepted). The browser checks find elements by role, not by
coordinates, but 1 139 places add string conditions of their own to what a Cloudscape component draws inside, and
only 27 files use Cloudscape's test selectors; no guide says which to use. One was the product's (issue 551, IAM: a
result shown from a dialog that the page unmounts when one of the reads started by the change answers first), which
no unit case covered because mocked reads always answer in one order.

Wanted, as rules where each kind of test has its rules, and nothing else:

1. `tests/integration/AGENTS.md` (how a check is written): what is inside a Cloudscape component (a select's or
   autosuggest's options, a table's rows and cells, a header's heading text and counter, a flash, a modal, a form
   field's error) is found with Cloudscape's test selectors (`@cloudscape-design/test-utils` selectors); an option
   is chosen by its value, not its text. Elsewhere an element is found by role and accessible name; `exact` and a
   whole-text pattern are used only when that string is what the scenario's line asserts. An assertion is made on
   the settled screen; a state in between (loading, a transition) is asserted only when the line is about it. What
   lets the next action go ahead is something shown on the screen, never a time.
2. `studio/references/test-criteria.md` (unit scenarios): a screen that reads again after a change has a unit case
   in which those reads answer in another order than the one the mock gives by default, for whatever the change
   shows afterwards (a result, a hand-over to another page).
3. `.agents/skills/pm/references/review-protocol.md`, the checklists of `plan-set` and `impl`: the reviewer looks
   for a check that finds the inside of a Cloudscape component by a string of its own, for an assertion on a state in
   between, and for a result shown from a component the page can unmount.
4. `engine/references/test-criteria.md`: an engine test waits for what it asserts (the line, the answer), never for
   a neighbouring sign that it should be there by now.

No test is added (issue 523). The checks already on `main` are not swept here: each is mended when it fails or when
its service's next issue touches its support file; the report names the support files that match strings inside
Cloudscape components today, by service, as a list for those issues.

## Evidence

Issue 551's `requirement.md` (sections 1 to 3) and `evidence/`; issue 533; `.pm/run/ci-2a72d8a.log`.

## Steps to Reproduce

Read `tests/integration/AGENTS.md`: nothing says how an element inside a Cloudscape component is found.

## Expected

A check written by the guides passes or fails by what the product does, on a fast and on a slow machine.

## Out of scope
