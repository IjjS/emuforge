Issue-Id: 666
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|log-alarms
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the CloudWatch log alarm screens: create and edit a log alarm

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Studio's CloudWatch alarm screens (issue 70) list a log alarm, open its page, switch its actions, tag it and
delete it, but give no way to make one or change one: "Create alarm" and "Edit alarm" build a metric alarm on one
metric only, and the edit screen answers "Studio cannot edit this alarm yet" for a log alarm. The emulator carries
`PutLogAlarm` out: the same request sent straight to aws-emulator makes the alarm, and `DescribeAlarms` with
`AlarmTypes` `LogAlarm` reads it back. A developer who wants a log alarm locally has to leave Studio for the CLI.

## Evidence
aws-emulator 1.0.633, called directly on loopback while planning issue 70 (SDK `@aws-sdk/client-cloudwatch` 3.1161.0):

```
PutLogAlarm p70-log	200	"ok"
  read back	200	{"name":"p70-log","ActionsEnabled":true,"updated":"2026-11-27T00:45:50.287Z"}
```

The input that was accepted: `AlarmName`, `ScheduledQueryConfiguration` (`QueryString`, `LogGroupIdentifiers`,
`ScheduledQueryRoleARN`, `ScheduleConfiguration` with `ScheduleExpression` `rate(5 minutes)` and `StartTimeOffset`
300, `AggregationExpression` `count(*)`), `QueryResultsToEvaluate` 1, `QueryResultsToAlarm` 1, `Threshold` 1,
`ComparisonOperator` `GreaterThanThreshold`, `Tags`. Without `ScheduleConfiguration.StartTimeOffset` the answer was
400. `PutMetricAlarm` on the name of a log alarm is 400 "AlarmName [x] is already used by another alarm of a
different type". `SetAlarmState` on a log alarm is 404. A log alarm's row of `DescribeAlarms` has
`ScheduledQueryConfiguration`, `QueryResultsToEvaluate`, `QueryResultsToAlarm`, `Threshold`, `ComparisonOperator`.

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Open `/aws/cloudwatch/alarms` and choose "Create alarm".
3. Look for a way to make an alarm on a Logs query: there is none.
4. Make a log alarm with the SDK (`PutLogAlarm`, the input above), open it in Studio and choose "Edit".

## Expected
- A developer can create a log alarm from Studio: its name, the query, the log groups, the schedule, the
  aggregation, the comparison and the threshold; the alarm made is read back with `DescribeAlarms` and shown.
- A developer can change a log alarm from its page; what the form does not offer is sent as it was read.
- A request the emulator refuses shows the operation's name and the emulator's reason, and keeps what was entered.

## Out of scope
Metric math, anomaly detection and composite alarms (issues 296, 294). Setting a log alarm's state, which the
emulator answers 404.
