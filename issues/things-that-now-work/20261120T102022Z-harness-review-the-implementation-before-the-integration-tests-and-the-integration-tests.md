Issue-Id: 619
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|lead.order|impl-review-before-integration-tests
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: c9843ccb7d3ce2af514e2d76109c6a654b55e894

# Review the implementation before the integration tests, and the integration tests by a review of their own

> Identified against commit `c9843ccb7d3ce2af514e2d76109c6a654b55e894`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Today an issue led by a plan ends: build, critique (while the plan writes the integration tests), the whole check,
then the one end review `impl`, which reads the whole diff and whether the integration tests are the scenarios
(`.agents/skills/pm/references/lead.md`, "Integration tests" to "End review"; `review-protocol.md`). The review comes
after the whole check, and a passing record holds for one commit, so whatever the review finds and the plan adopts
moves the head and the whole check runs again, about 15 minutes with every service's browser checks.

On 2026-11-20 four issues ran the whole check eight times in all; none of the repeats was for a fault of the product
that an integration check caught: issue 576 after impl r1's P2 and P3; issue 573 after two issue-file commits;
issue 574 once for packages not installed after `--take-main` (issue 440) and once after impl r1's three comment
lines and one test line.

The owner's order (2026-11-20): build, then the review of the implementation, then the integration tests written
and run, then a review of the integration tests, which reads the integration tests alone.

So the end review becomes two stages:

- `impl`: after every unit is merged and the critique has passed (its fixes change the code the review reads),
  before the integration tests exist. It reads the diff of the product code and the unit tests, on the units' fast
  checks; it is given no whole check's record. Its P1 are fixed by the workers before any integration test is run.
- a stage for the integration tests (a name is the engineer's to propose, e.g. `tests`): it reads only the
  integration tests, their support and manifest rows against the scenarios of `test-criteria.md`, and nothing of
  the product code.

To settle in the plan (`output/plan.md`), with the reason:

- Where the whole check stands against the tests' review. The owner's words put the review after the run. If the
  review's findings on the tests then move the head, the whole check runs twice again; the plan already runs its
  checks singly while it writes them (`pm-check --checks`, never a gate), so the review could read the tests before
  the one whole check. Say which, and what the record then proves.
- What `pm-merge <id>` asks for: today the newest `review-impl-r<k>.md` with `verdict: pass`; then both stages'.
- An issue that leaves its integration tests out (`test-criteria.md` says so before the build): the tests' stage
  has nothing to read.
- An issue in flight when this lands: it finishes under the order it began with.
- `pm-brief rev`, `briefs/rev.md` and `briefs/plan.md` where they name the stages; three rounds at most per stage
  stays.

## Evidence

`.pm/archive/576.md`, `.pm/archive/573.md`, `.pm/archive/574.md` (each report's record section lists its whole checks and why each ran); `.agents/skills/pm/references/lead.md` and `review-protocol.md` on `main` at `c9843ccb7`.

## Steps to Reproduce

Lead any issue to its end: the `impl` review follows the whole check, and one adopted finding runs the whole check again.

## Expected

- `lead.md`, `review-protocol.md`, the briefs and the pm skill give the new order; the implementation's review reads no integration test and the tests' review reads nothing else.
- A finding of the implementation's review never causes a second whole check, since none has run yet.
- `pm-merge <id>` merges an issue branch only with both reviews passed (or the tests' stage not owed) and the whole check's record on its head.
- No test is added to the harness (issue 523).

## Out of scope

A passing record that survives a head moved only by paths no step reads, such as issue files (a separate change of `pm-merge`). A mock before the build. Issue 440 (packages after `--take-main`).
