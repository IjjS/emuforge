Issue-Id: 297
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|dashboards
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch dashboard screens: list, detail, create, update, delete

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/cloudwatch/dashboards` shows the area's "no screen yet" page. The emulator holds dashboards.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-dashboard --dashboard-name probe70-dash --dashboard-body '{"widgets":[{"type":"text","x":0,"y":0,"width":6,"height":3,"properties":{"markdown":"probe"}}]}'
{ "DashboardValidationMessages": [] }
$ aws cloudwatch put-dashboard --dashboard-name probe70-bad --dashboard-body 'not json'
InvalidParameterInput: The field DashboardBody must be a valid JSON object
$ aws cloudwatch list-dashboards   -> 200, DashboardEntries [probe70-dash, Size 96]
$ aws cloudwatch get-dashboard --dashboard-name probe70-missing
ResourceNotFound: Dashboard probe70-missing does not exist
$ aws cloudwatch delete-dashboards --dashboard-names probe70-dash   -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and put a dashboard with the AWS CLI.
2. Open `/aws/cloudwatch/dashboards`.
3. The page says there is no screen yet.

## Expected
- The emulator's dashboards are listed; one opens on its page; a dashboard can be created, its body changed, and deleted.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Rendering widgets with live metric graphs is for the requirement to scope. Any engine change. Anything sent to real AWS.
