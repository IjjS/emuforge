Issue-Id: 524
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda.log-and-numbers|task
Issue-Check-Ids: studio.lambda-monitor-reads-invocations studio.lambda-monitor-explains-missing-logs studio.lambda-monitor-reconnects studio.lambda-monitor-entered-after-reconnect
Issue-Commit: 7b260c508348edd256975ce57d7da11104dc8891

# Build Lambda's task 7: read a function's log across invocations and its invocation numbers

> Identified against commit `7b260c508348edd256975ce57d7da11104dc8891`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Task 7 of Lambda's task list (issue 516, `requirement.md`, "Tasks, in order of importance"): a developer reads what a
function logged across its invocations, and how often it ran and failed. Studio shows only the log tail of the one
invocation made on the tab "Test" (at most 4096 bytes); what an event source mapping or another client invoked leaves
nothing a developer can read in Studio. The reference is the same request sent straight to aws-emulator: CloudWatch
Logs `FilterLogEvents` on the log group `/aws/lambda/{name}` and CloudWatch `GetMetricStatistics` on the namespace
`AWS/Lambda`. This task takes the place of issue 353 (the "Monitor" tab, cut the old way).

## Evidence

Found by the plan of issue 516 on aws-emulator 1.0.515 (2026-11-19) with its own emulator; the scripts and their output are in `.pm/issue-516/probe/` (after the issue is archived: the requirement's section "What the emulator supports" under `.pm/archive/516/`). No operation named here answered 501.

- `probe-4.log`, "## a role with the managed policy Studio's create form attaches": with `AWSLambdaBasicExecutionRole`
  attached to the function's role, `FilterLogEvents` returned every line of three invocations, one log stream per
  invocation, paged by `nextToken` and filtered by a pattern.
- `probe-1.log`, "## the log in CloudWatch Logs": with a role without that policy there is no log group.
- `probe-4.log`, "# delete the function: is its log kept": the log group stays after the function is deleted.
- `probe-2.log`: CloudWatch holds `AWS/Lambda` metrics per function.
- `probe-1.log`, "# a long log": of a log of 400 lines the tail of `Invoke` held the last 55.

## Steps to Reproduce

1. Start a fresh emulator and Studio; create a function on `/aws/lambda/functions/create`.
2. Open the function's page `/aws/lambda/functions/function/{name}`: its tabs are "Test", "Code" and "Configuration".
3. There is no place that shows the function's log beyond the tail of the invocation just made, nor its invocation numbers.

## Expected

- A developer reads the log lines of a function's earlier invocations, newest first or by time, and reads further back.
- A function whose role may not write logs says that it has no log and why, not an empty list alone.
- The numbers of invocations and errors the emulator's CloudWatch holds for the function are shown.
- Each proven by a scenario against the real emulator.

## Out of scope

Logs Insights, live tail, alarms, X-Ray; the CloudWatch service's own screens.
