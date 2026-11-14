# Engine workflow

Stages of an issue whose `Issue-Module` is `engine`, `cli`, `iam` or `verify`. The issue file under `issues/`
states the problem and its acceptance; the stage documents below are working files in the issue's folder and
are reviewed by `rev` one at a time.

## Principles

- A work item is one capability at the engine's boundary: something a caller can send and observe. It is never
  "add a struct" and never a whole product area.
- The reference decides, not taste. For the relay it is the same request sent straight to aws-emulator; for
  the CLI it is the AWS CLI; for IAM it is AWS's documented policy evaluation logic.
- Each stage is written once, reviewed, and then treated as fixed. A later stage that finds an earlier one
  wrong sends it back; it does not quietly work around it.

## Stages by kind

| Kind | 1 Requirement | 2 Design | 3 Test Criteria | 4 Implementation | 5 Verification |
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
- How the work splits into units, and which files each unit owns.

## 3. Test Criteria

Per `references/test-criteria.md`. Unit cases and integration checks are both listed here, before any code.

## 4. Implementation

In the issue's worktree, on its branch, only the files the unit owns. Conventions: `engine/AGENTS.md`.

## 5. Verification

- The three commands in `engine/AGENTS.md` pass.
- Every integration check listed in stage 3 passes against a fresh emulator, and no check that passed on
  `main` now fails.
- The relay fidelity score is not lower than on `main` (`references/relay-fidelity.md`).
- Evidence paths for all of the above are in the unit's report. Then `rev` reviews the implementation, and the
  `pm` merges.
