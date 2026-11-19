Issue-Id: 521
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: bug
Issue-Source: owner
Issue-Key: harness|tests|no-test-pins-the-size-of-a-list-that-grows
Issue-Check-Ids:
Issue-Commit: 39901f4340fa12d8bce100199cfa44235350260c

# Remove the tests that pin how many entries a growing list has

> Identified against commit `39901f4340fa12d8bce100199cfa44235350260c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19: "목록의 개수나 유일함은 이거 없애버려. 아니 지원되는 서비스가 늘어나는데 목록의 개수는 유일하다고?
… 왜 그런 쓸데 없는 테스트 때문에 헛돌아야되는건데".

Some harness tests assert the size of a list that every issue of a certain kind makes longer, so the issue that adds
an entry fails a test of something it did not break, and two issues that each add one and each correct the number
clash when both land. Known on `main` at `39901f4`:

- `.pm/bin/tests/test_integration_not_run.py:296`: `assertEqual(len(PRODUCT_IDS), 28)`. Issues 484, 485 and 503 each
  had to change the number (… 23, 28), 503 after a failed whole check.
- `.pm/bin/tests/test_on_touch.py:1052`: `assertEqual(len(SCAN_RULES), 29)`.
- `.pm/bin/tests/test_probe_services.py:176`: `assertEqual(len(keys), 224)`; the board grows or shrinks with the
  captures.

Wanted: no test of the harness, of Studio, of the engine or under `tests/integration/` pins the number of entries of a
list that grows with the product or the harness (checks, product checks, services, screens, scan rules, catalogue
messages, manifest rows, board keys). The engineer searches all four for such assertions, removes each, and where the
number stood in for a real property puts that property in its place (every entry well formed, the two lists equal,
no entry twice by its key, the list not empty). A number that is the behaviour under test stays (a page of 25
items, the 50-tag limit, 1 000 keys a delete call). One sentence where test rules live for each module says it, so a
new test does not bring one back. The report lists every assertion found, removed or kept, with its reason. Product
test files are changed by this harness issue on the owner's word.

## Evidence

The three lines above; issue 503's report ("For the pm").

## Steps to Reproduce

Add one product check to the manifest and run the harness tests.

## Expected

Adding an entry to a list fails no test that the entry does not break.

## Out of scope
