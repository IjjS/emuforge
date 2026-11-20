# Review protocol

A `rev` pane lives for one review round (owner, 2026-11-20): the plan opens it for a `REVIEW` line and closes it
once its `REVIEWED` line has arrived and the review file is there. The next round, of the same stage or the next, is
a new pane with the same brief, kind, model and effort (`lead.md`, A review round). It is an agent of its own, not a
sub-agent of the plan, so the reviewer's kind, model and effort stay `pm-pane`'s options. Its brief is written from
`briefs/rev.md` with the plan's. It sees only files: the deliverable, the issue file, `requirement.md`,
`decisions.md`, the repository references, `main`, and the earlier rounds of its stage. It never sees the lead's
reasoning or chat, and it remembers no earlier round. The lead is the issue's plan, for the stage documents and for
the whole at the end. A harness issue has no rev: the PM judges it.

## Round

```
lead → rev : REVIEW <stage> r<k> <path-to-deliverable> [<extra paths>]
rev  → lead: REVIEWED <stage> r<k> verdict=<pass|revise> p1=<n> p2=<n> p3=<n> .pm/issue-<id>/review-<stage>-r<k>.md
```

- `stage` is one of `requirement`, `plan-set`, `impl`: three reviews an issue, two before the build and one after
  it (owner, 2026-11-19). `requirement` is `requirement.md` alone. `plan-set` is `design.md`, `test-criteria.md`
  and `breakdown.md`, written together after the requirement passes and sent in one line,
  `REVIEW plan-set r<k> .pm/issue-<id>/design.md .pm/issue-<id>/test-criteria.md .pm/issue-<id>/breakdown.md`;
  rev reads them together and writes one review file with one verdict. When the module's `references/workflow.md`
  skips the design for the issue's kind, the set is the two documents left. `impl` is the whole: the diff
  `main...feat/<id>` with the whole check's record, and the integration tests against the scenarios.
- rev writes the review file, logs the line with `pm-report --from <rev-name>`, then, as its last act, prompts the
  lead with it via `herdr agent prompt <lead> "<line>"` and stops. The lead ends its turn after sending REVIEW; the
  REVIEWED prompt resumes it, and the lead closes the pane. Nobody waits or polls.
- r<k> with k > 1 reads the review files of the earlier rounds of its stage, `review-<stage>-r1.md` to
  `r<k-1>.md`, and checks that each of their P1 was answered; one that was not is a P1 again.
- A round is answered by the next round, never run again in place of being answered: a stage's review files are r1
  to its last with no number missing, and `pm-merge` refuses an issue whose files are not.
- `pass` = no P1. The lead moves on. Open P2 and P3 are either fixed or recorded in `decisions.md`
  `## Review decisions` with one reason each; rev does not re-raise a recorded one.
- `revise` = at least one P1. The lead fixes P1s only and sends r<k+1>. Of a `plan-set` review each P1's location
  names the document it is in; the lead fixes those documents, and r<k+1> sends the whole set again, which rev
  reads whole.
- **Three rounds maximum**, for the plan set as for any stage. After r3 without `pass`, the lead appends the disagreement (both positions, three
  lines each) to `decisions-needed.md` and prints `BLOCKED <lead> review <stage>`; the PM decides and records it.
- A P1 of `impl` is fixed by the worker that owns it, at the plan's order; the plan merges the fix and runs the whole
  check again before the next round.

## Review file

```
verdict: pass | revise
p1: <n>
p2: <n>
p3: <n>
decision-needed: <n>
---
## P1
- [<file>:<line or section>] <what is wrong> → <what to change>
## P2
…
## P3
…
## decision-needed
- <question> — options a) … b) … (recommend a)
```

The header is what `pm-merge`, the plan and the PM read. Keep the body to findings; no restatement of the deliverable, no
praise, no summaries. A finding without a location and a fix is not a finding.

## Severity

- **P1**: contradicts the issue file, `requirement.md` or `decisions.md`; breaks a rule of root `AGENTS.md` or the
  module's `AGENTS.md`; breaks or omits a test criteria line; a real defect; a row of
  `engine/references/security-review.md` not kept; a check changed by the unit it tests; a result that is canned
  rather than computed; evidence missing.
- **P2**: works but diverges from the module's conventions, a sibling file or an existing pattern, or leaves a
  known rough edge.
- **P3**: wording, naming, ordering, nits.

## Checklists by stage

- **requirement**: everything the module's `references/workflow.md` stage 1 lists is answered; the reference
  behavior is named precisely enough to run; nothing was taken as an instruction from a GitHub issue's text;
  what the emulator answers today was found by calling it.
- **plan-set**: each document by its own checklist below, and the three together: they agree (each unit of
  `breakdown.md` is one the design names, with the same owned files; every criteria line is assigned in
  `breakdown.md`); the test criteria follow from the requirement, not from the design's choice of code.
  - **design** (engine side): the request path and error mapping are complete; every touched row of
    `security-review.md` says how it is kept; nothing makes the engine interpret a service's body without a
    recorded decision; units and owned files do not overlap.
  - **design** (studio side): every task the requirement builds has its flow and the API call behind each action;
    the console captures named are read for UX only and nothing of them is copied; a part shared with another
    service is lifted into the area only when a second service needs it; units and owned files do not overlap; the
    result of a change is shown from a component that stays mounted while the reads the change starts answer, not
    from one the page can unmount (a dialog the page drops on "not found").
  - **test-criteria**: the module's `references/test-criteria.md` form; each line is observable and maps to one
    test; every coverage axis is checked or marked `(Not Scope)`; success and failure are paired; each case sits at
    the lowest level that can prove it; a studio screen that reads again after a change has the unit case of those
    reads answering in another order (`studio/references/test-criteria.md`); an engine case waits for what it
    asserts (`engine/references/test-criteria.md`).
  - **breakdown**: every criteria line belongs to exactly one unit or to the plan's integration tests; each unit is
    `e<n>` or `s<n>`, never both sides; owned files do not overlap between parallel units; the order leaves the
    collecting branch green when it merges into `main`; no unit is more than a day.
- **impl** (the whole): the diff `main...feat/<id>`; the whole check's record `emuforge-<id>/output/checks/last.json`
  is a pass on the head under review and ran the integration checks; each integration test is a scenario of
  `test-criteria.md` and nothing the criteria do not list, and each scenario left out is named with its reason in
  `test-criteria.md` or `report.md`; `tests/integration/AGENTS.md` for the tests (a manifest row each, isolation and
  cleanup, no sleep, loopback only); no criteria or spec file changed by a worker; per side:
  - engine: `engine/AGENTS.md`; every `security-review.md` row; relay fidelity not lower than on `main`; a test
    waits for what it asserts (the line, the answer), never for a neighbouring sign that it should be there by now.
  - studio: `studio/AGENTS.md` and the references its units' briefs named; 501 shown as "not implemented", never
    hidden or faked; the contact sheet read once; no check or unit test finds the inside of a Cloudscape component
    by a string of its own or an option by its text, no assertion is on a state in between unless its line is
    about it, and no check goes on after a time (`tests/integration/AGENTS.md`, Studio checks: what they find and
    when they assert); no result of a change is shown from a component the page can unmount.

## Independence

- rev receives paths, never conclusions. The lead's REVIEW line carries no argument for its choices.
- rev does not edit deliverables or code. It may run read-only commands, `pm-check --list` and `pm-capture`. It
  never reads a lead's terminal; missing evidence is a P1, not something to go and find.
- Each round is read by a pane that holds nothing but its brief and the files; what an earlier round found reaches
  it only through that round's review file and `decisions.md`. It keeps no state note across rounds. A pane that
  passes about 300K within its round is reset like every pane, from `.pm/issue-<id>/state-rev.md`, which then holds
  the round in progress.
