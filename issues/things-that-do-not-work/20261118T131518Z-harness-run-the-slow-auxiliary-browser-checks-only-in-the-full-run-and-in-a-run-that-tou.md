Issue-Id: 482
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|integration|auxiliary-checks-run-in-full-only
Issue-Check-Ids:
Issue-Commit: e57ae6154646de50006f26c9031b6332666bebe1

# Run the slow auxiliary browser checks only in the full run, and in a run that touches their own service or paths

> Identified against commit `e57ae6154646de50006f26c9031b6332666bebe1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-18, shown where the integration step's time goes: "시간먹는 44개는 사실 약간 크리티컬하지 않잖아.
보조형 느낌인데.. 그럼 메뉴얼 실행하는 CI에 그것도 같이 넣으면 안되나??" (the slow ones are auxiliary; put them in
the manually started CI run).

On the runner (run of `6859ed2`) the integration step took 1224 s, of which the 148 browser checks took about 940 s
one at a time; 104 of them took under 5 s each (197 s in all), and 44 took over 5 s (727 s). Of those 44 the `pm`
decided which are auxiliary (`.pm/issue-<id>/decisions.md`): the checks of every language's layout and words, the
brand's layout, the five-digit port addresses (139 s alone), each service's keyboard and layout, and each
service's "follows the emulator's stop and restart" and "says when the engine stops answering". The business
scenarios, the safety and isolation checks, one app-level recovery check of the AWS area's emulator line and one of
Home, and the dialog-focus check of issue 462 stay in every run.

A new tier of a check, `full`, is wanted: its row in the manifest says so; it runs in `.github/workflows/full.yml`
(which the owner starts by hand), in `pm-check --full`, and in a run whose changed paths call for it: a check with a
`service` when that service's paths changed (the selection of issues 327 and 402), a check of no service when the
paths its row names changed (the frame, `i18n/`, `brand/`, as the row says). It does not run in a push run of
`main.yml` or a whole check otherwise. The tier `on-request` of issue 315 stays as it is (not even in `full`).

## Evidence

The runner's log of the integration step of https://github.com/IjjS/emuforge/actions/runs/44305532798 (per check
times in the `studio: passed … (<n>s)` lines). The list of 44 with their times is in the issue's `decisions.md`.

## Steps to Reproduce

Read the times of the browser checks in any integration log.

## Expected

A push run's and a whole check's integration step that holds the business, safety and isolation checks and the
auxiliary checks only of what the change touched; the full run holds them all; nothing is lost from the full run.

## Out of scope
