Issue-Id: 570
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|lambda|environment-variables-order-follows-the-emulators-answer
Issue-Check-Ids:
Issue-Commit: f52fddc501b4726bf50ae4ec7f5ea046ee53b7b1

# Lambda's environment variables are shown in whatever order the emulator answers, and a check asserts one order

> Identified against commit `f52fddc501b4726bf50ae4ec7f5ea046ee53b7b1`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The run of `main.yml` for the push of `70c1a2b` (issue 551) failed `integration` in its first run on
`studio.lambda-configuration-edits-reach-the-emulator`, one line of seven: after "Edit" of "Environment variables"
(`GREETING` to `hello-2`, "Add variable" `EXTRA` = `x`, "Save") the check expects the section's rows as
`GREETING`, `EXTRA` and read `EXTRA`, `GREETING` (emulator 1.0.533 on the runner; 1.0.531 on the owner's machine,
where the check passed the same morning). `Environment.Variables` is a map: the emulator may answer it in any
order, and Studio shows the rows in the order of the answer. The critique of issue 516 named "the variables' order"
among its P3 (#532).

To find first: whether the order is the product's to fix (the rows in one stated order, by key, on the tab and in the
editor) with the check asserting that order, or the check's alone (rows compared as a set). The three checks of
issue 551 passed in this run.

Filed from a run on GitHub Actions: it waits for the owner's signal.

## Evidence

https://github.com/IjjS/emuforge/actions/runs/44659707222 ; the first integration run's log `.pm/run/ci-70c1a2b.integration-first-run.log`.

## Steps to Reproduce

Intermittent, by the order of the emulator's answer: `studio.lambda-configuration-edits-reach-the-emulator`.

## Expected

The variables are shown in one stated order whatever the emulator answers, and the check holds on every run.

## Out of scope
