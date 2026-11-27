Issue-Id: 667
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|anomaly-detectors
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the CloudWatch anomaly detector screens: list, create, delete

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The CloudWatch service in Studio has an entry "Anomaly detectors" (`/aws/cloudwatch/anomaly-detectors`) with no
screen: it opens the area's page for an entry without a screen. The emulator answers `DescribeAnomalyDetectors`,
`PutAnomalyDetector` and `DeleteAnomalyDetector`: the same requests sent straight to aws-emulator with the AWS CLI
make a detector, list it and delete it. A developer cannot see or manage the detectors of the emulator in Studio.

## Evidence
aws-emulator 1.0.633, called directly on loopback while planning issue 70 (AWS CLI 2.34.53):

```
$ aws cloudwatch put-anomaly-detector --single-metric-anomaly-detector Namespace=Probe70/App,MetricName=Errors,Stat=Sum
[exit 0]
$ aws cloudwatch describe-anomaly-detectors
{ "AnomalyDetectors": [ { "Namespace": "Probe70/App", "MetricName": "Errors", "Dimensions": [], "Stat": "Sum",
    "Configuration": { "ExcludedTimeRanges": [] }, "StateValue": "PENDING_TRAINING",
    "SingleMetricAnomalyDetector": { "AccountId": "000000000000", "Namespace": "Probe70/App", "MetricName": "Errors", "Dimensions": [], "Stat": "Sum" } } ] }
[exit 0]
$ aws cloudwatch delete-anomaly-detector --single-metric-anomaly-detector Namespace=Probe70/App,MetricName=Errors,Stat=Sum
[exit 0]
```

With an empty input: `DescribeAnomalyDetectors` 200 (`AnomalyDetectors`), `PutAnomalyDetector` 400
`MissingRequiredParameterException`, `DeleteAnomalyDetector` 400 "Either an AnomalyDetectorId or a metric definition
must be provided to identify the anomaly detector to delete."; none answers 501.

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Run the `put-anomaly-detector` command above against the emulator.
3. Open `/aws/cloudwatch/anomaly-detectors` in Studio: the area's page for an entry without a screen, no detector.

## Expected
- `/aws/cloudwatch/anomaly-detectors` lists the emulator's anomaly detectors with their metric, statistic and state.
- A developer can create a detector on a metric and delete one; the list shows the result read from the emulator.
- An operation that answers 501 is shown as "Not implemented by the emulator" with its name.

## Out of scope
An alarm on an anomaly detection band (issue 296). What a real detector learns from data: the emulator's state is
shown as it answers.
