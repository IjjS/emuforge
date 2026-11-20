Issue-Id: 551
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ci|three-browser-checks-fail-on-the-run-after-sns-merged-behind-main
Issue-Check-Ids: studio.iam-policy-delete-detaches-and-removes studio.sns-topics-made-elsewhere-are-shown studio.sns-subscribe-a-function-and-it-runs
Issue-Commit: 2a72d8a0c10bb46f13863bb2f67af94ca94ff1a5

# Three browser checks of IAM and SNS fail on GitHub Actions after SNS merged behind main

> Identified against commit `2a72d8a0c10bb46f13863bb2f67af94ca94ff1a5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main.yml` for the push of `2a72d8a` (issue 536, SNS) failed at `integration`, in the step and in its
second run, on three browser checks (emulator 1.0.523, 289 checks, the other 286 passed):

- `studio.iam-policy-delete-detaches-and-removes`: the line "On S5 of `<p>-race`, "Delete" opens the dialog; the
  policy is deleted directly; confirm → the Flashbar reports the failed step with `NoSuchEntity`, and the page shows
  "Policy not found"": the failed step with `NoSuchEntity` was not shown within 30 s.
- `studio.sns-topics-made-elsewhere-are-shown`: the line "Open S3 at the ARN of a topic the emulator does not hold →
  "Topic not found" with "View topics", which leads to S1": the heading "Topics" (level 1) was not found within
  10 s.
- `studio.sns-subscribe-a-function-and-it-runs`: four of six lines; first, on S4 with "AWS Lambda" the function made
  for the check is not among the options of "Function" within 10 s, and what follows from it fails.

`feat/536` was merged behind `main` by 73 paths (issue 535, IAM, had landed; `events.log`, 2026-11-20T01:53:01), by
the rule of issue 520, so the merged tree was first checked by this run. Each side had passed alone: IAM's own run on
GitHub Actions (`00fbbf4`) passed `integration` with the IAM check among them 40 minutes earlier, on the same
emulator version; `feat/536` passed its whole check three times on the owner's machine with SNS's checks. To find
first: whether the two changes break each other (IAM's side navigation and role screens against SNS's
`components/resource-paths.ts` and the shared `support/aws-clients-general.ts`; a function list that pages or is cut
when every service's checks fill one emulator), or the three checks are too tight for the runner (a `Timeout` at 30 s
and two at 10 s), in which case the same lines are to be looked at on a busy machine.

By the owner's decision of 2026-11-19 (issue 520, point 4) the `pm` starts this without waiting for a signal, and
merges nothing else into `main` until it is in. The same run also failed `engine-test` on the test of issue 533,
which is apart.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44571161759 ; the failed steps' log `.pm/run/ci-2a72d8a.log`.

## Steps to Reproduce

On `main` at `2a72d8a`: the three checks, with every service's checks beside them as the run on GitHub Actions has them.

## Expected

The three checks pass on `main` on GitHub Actions.

## Out of scope
