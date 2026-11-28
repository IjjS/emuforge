Issue-Id: 669
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|datasets-and-resource-metrics-configurations
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Show the CloudWatch dataset and resource metrics configurations

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The emulator's CloudWatch holds a dataset (`GetDataset` of `default` answers 200 with its ARN, and the two KMS key
operations answer by rule) and knows the resource metrics configuration operations, of which the read answers 400
"Unsupported resource type" and the three writes answer 501. Studio's CloudWatch screens (issue 70) show neither:
both are reads of one item with no list, so they gave no entry. The same requests sent straight to aws-emulator
answer as below.

## Evidence
aws-emulator 1.0.633, called directly on loopback while planning issue 70 (SDK `@aws-sdk/client-cloudwatch` 3.1161.0), with real arguments:

```
GetDataset default	200	{"DatasetId":"default","Arn":"arn:aws:cloudwatch:us-east-1:000000000000:dataset/default"}
AssociateDatasetKmsKey	400	ValidationException: 1 validation error detected: Value null at 'kmsKeyArn' failed to satisfy constraint: Member must not be null
DisassociateDatasetKmsKey	404	ResourceNotFoundException: No CMK association found for dataset default.
CreateResourceMetricsConfiguration	501	NotImplemented: operation CreateResourceMetricsConfiguration is scaffolded but not implemented in this emulator
GetResourceMetricsConfiguration	400	ValidationException: Unsupported resource type
UpdateResourceMetricsConfiguration	501	NotImplemented: operation UpdateResourceMetricsConfiguration is scaffolded but not implemented in this emulator
DeleteResourceMetricsConfiguration	501	NotImplemented: operation DeleteResourceMetricsConfiguration is scaffolded but not implemented in this emulator
```

## Steps to Reproduce
1. Start a fresh emulator and Studio on it.
2. Send `GetDataset` with `DatasetIdentifier` `default` to the emulator: 200.
3. Look for the dataset under `/aws/cloudwatch` in Studio: it is shown nowhere.

## Expected
- A CloudWatch screen shows the dataset the emulator holds and its KMS key association, and lets a developer
  associate and disassociate a key; each result is what the read after gives.
- The resource metrics configuration operations that answer 501 are shown as "Not implemented by the emulator"
  with the operation's name, never hidden or faked; a screen for them is built only as far as the emulator answers.

## Out of scope
Implementing the three 501 operations: that is the emulator's, reported upstream, not an EmuForge issue.
