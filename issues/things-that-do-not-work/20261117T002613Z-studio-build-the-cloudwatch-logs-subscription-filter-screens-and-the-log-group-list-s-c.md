Issue-Id: 318
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|subscription-filters
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the CloudWatch Logs subscription filter screens and the log group list's column "Subscription filters"

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's log group list has a column "Subscription filters" and a log group's page shows its subscription filters. Studio's log group list (issue 71) does not have the column, recorded in the header comment of its reference spec `log-group-list.yaml`, and nothing lists, creates or deletes a subscription filter. The emulator holds subscription filters, for groups of the Standard class only.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
$ aws logs put-subscription-filter --log-group-name p71-a-standard --filter-name p71-sf2 --filter-pattern '' --destination-arn arn:aws:kinesis:us-east-1:000000000000:stream/p71-stream --role-arn arn:aws:iam::000000000000:role/p71-role
[exit 0]
$ aws logs put-subscription-filter ... --destination-arn arn:aws:lambda:us-east-1:000000000000:function:p71-fn
InvalidParameterException: Could not execute the lambda function. Make sure you have given CloudWatch Logs permission to execute your function.
$ aws logs describe-subscription-filters --log-group-name p71-a-standard   -> 200, subscriptionFilters [p71-sf2] with destinationArn, roleArn
$ aws logs describe-subscription-filters --log-group-name p71-b-ia   (class INFREQUENT_ACCESS)
ValidationException: This operation is only supported on the Standard log class.
$ aws logs describe-subscription-filters --log-group-name p71-missing
ResourceNotFoundException: The specified log group does not exist.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a log group and a subscription filter to a Kinesis stream with the AWS CLI.
2. Open `/aws/logs/log-groups`.
3. The list has no column "Subscription filters" and the group's page does not show the filter.

## Expected
- The list has the column "Subscription filters" between "Contributor Insights" and the table's end, as the console orders it, and the column is added to `log-group-list.yaml`.
- A log group's subscription filters are listed on its page; a filter can be created and deleted.
- The requirement says how the column is read (`DescribeSubscriptionFilters` takes one log group) and what a group that is not Standard shows.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Account-level subscription filter policies (the account policies are with the data protection issue or the rest-of-the-API issue, as the requirement finds). Any engine change. Anything sent to real AWS.
