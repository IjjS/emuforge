Issue-Id: 353
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|function-monitor
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build a Lambda function's "Monitor" tab from what the emulator's CloudWatch holds

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A function's tab "Monitor" (issue 84) leads to `/aws/lambda/functions/function/<name>/monitor`, which shows the area's "no screen yet" page. The emulator's CloudWatch holds metrics of the namespace `AWS/Lambda` per function after an invocation; its CloudWatch Logs held no log group for the function.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda invoke --function-name r84-nodejs22-x-x86_64 ...   -> StatusCode 200
$ aws cloudwatch list-metrics --namespace AWS/Lambda   -> ok, metrics with the dimension FunctionName for each invoked function
$ aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=r84-nodejs22-x-x86_64 --period 3600 ...   -> ok, one datapoint, Sum 1.0, Unit Count
$ aws logs describe-log-groups --log-group-name-prefix /aws/lambda/q84-t2 (after an invocation of q84-t2)   -> ok, []
$ aws logs describe-log-streams --log-group-name /aws/lambda/q84-t2   -> ResourceNotFoundException "The specified log group does not exist."
$ aws logs describe-log-groups (the whole emulator, after the invocations)   -> ok, []
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a function with the AWS CLI.
2. Open `/aws/lambda/functions` and the function's page.
3. Invoke the function with the AWS CLI.
4. Choose the tab "Monitor".
5. The page says there is no screen yet.

## Expected
- The tab shows the function's metrics the emulator holds (the requirement lists them by calling), read through the engine, for a period the user chooses.
- The requirement finds out why an invocation leaves no log group (a role without the logs permissions, or the emulator writes none); the tab shows the function's log streams if there are any, and says so in EmuForge's own words if the emulator keeps none.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
CloudWatch's own screens (issue 70 and those filed from it). Alarms. X-Ray traces. Any engine change. Anything sent to real AWS.
