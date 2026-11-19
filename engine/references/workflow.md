# Engine workflow

Stages of an issue whose `Issue-Module` is `engine`, `cli`, `iam` or `verify`, led by its `plan`
(`.agents/skills/pm/references/lead.md`). The issue file under `issues/` states the problem and its acceptance; the
stage documents below are working files in the issue's folder, reviewed by `rev` twice before the build: the
requirement alone, then design, test criteria and breakdown as one set, the plan set (`lead.md`).

## Principles

- A work item is one capability at the engine's boundary: something a caller can send and observe. It is never
  "add a struct" and never a whole product area.
- The reference decides, not taste. For the relay it is the same request sent straight to aws-emulator; for
  the CLI it is the AWS CLI; for IAM it is AWS's documented policy evaluation logic.
- Each stage is written once, reviewed, and then treated as fixed; the plan set's three documents are reviewed
  as one. A later stage that finds an earlier one wrong sends it back; it does not quietly work around it.

## Stages by kind

| Kind | 1 Requirement | 2 Design | 3 Test Criteria | 4 Build | 5 Verification |
|---|---|---|---|---|---|
| `feature` | yes | yes | yes | yes | yes |
| `gap` | the difference from the reference | only when a public type or the request path changes | yes, including the check that showed the gap | yes | yes |
| `bug` | reproduction, expected behavior, cause | skip unless the fix moves a responsibility between crates | yes, including the regression | yes | yes |

`Requirement` and `Test Criteria` are never skipped.

## 1. Requirement

Written from the issue file and the repository. Covers:

- Who calls (Studio, the CLI, a third-party tool) and what they send.
- What they observe: status, body, exit code, output, for success and for each failure.
- The reference behavior this must match, named precisely enough to run.
- Upstream conditions that matter: emulator down, emulator restarted with new keys, an operation the emulator
  answers with HTTP 501.
- Whether the change touches the trust boundary (who may call, what is forwarded, what is read from disk, what
  process is started). If yes, the Design stage includes the security review.
- What is out of scope.

## 2. Design

- The path of a request through the crates, and what each crate adds.
- New or changed public types, traits and configuration keys.
- Error mapping: which failure becomes which error, in which protocol shape.
- Failure modes and what the caller sees for each.
- `references/security-review.md`, row by row, for every row the change touches: how the rule is kept.
- How the work splits into units (`breakdown.md`): `e<n>` units, each with the files it owns.

## 3. Test Criteria

Per `references/test-criteria.md`, before any code: the unit-test scenarios of each unit, which are the end
condition its worker's brief carries, and the integration scenarios the plan writes as tests after the build, or
leaves out with its reason.

## 4. Build

Each unit in its own worktree, by its worker, only the files it owns, with the unit tests its brief's scenarios
ask. Conventions: `engine/AGENTS.md`, `references/security-review.md`, `references/relay-fidelity.md`. A worker
writes no integration test.

## 5. Verification

- The three commands in `engine/AGENTS.md` pass on each unit (its fast check, `pm-check`).
- When every unit is merged into the issue branch, the plan writes the integration tests from the scenarios of
  stage 3 (`tests/integration/AGENTS.md`). The whole check on the issue branch runs them against a fresh emulator,
  with every check that passed on `main`, and passes; its record is the evidence.
- The relay fidelity score is not lower than on `main` (`references/relay-fidelity.md`).
- `rev` reviews the whole (the diff, the record, and whether the integration tests are the scenarios), and the
  `pm` merges.
