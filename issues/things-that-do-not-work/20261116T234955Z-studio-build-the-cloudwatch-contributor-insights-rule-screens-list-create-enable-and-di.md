Issue-Id: 300
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|cloudwatch|contributor-insights-rules
Issue-Check-Ids:
Issue-Commit: a6081efbb405b164c3ca6cc05231ccf318eaefa7

# Build the CloudWatch Contributor Insights rule screens: list, create, enable and disable, delete, report

> Identified against commit `a6081efbb405b164c3ca6cc05231ccf318eaefa7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/cloudwatch/contributor-insights` shows the area's "no screen yet" page. The emulator holds Contributor Insights rules.

Reference: the AWS console's CloudWatch screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the CloudWatch User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the alarm screens of issue 70 are: `console` screens of the area, a reference spec each under `studio/references/console/cloudwatch/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 70:

```
$ aws cloudwatch put-insight-rule --rule-name probe70-rule --rule-state ENABLED --rule-definition '{"Schema":{"Name":"CloudWatchLogRule","Version":1},"LogGroupNames":["probe70"],"LogFormat":"JSON","Contribution":{"Keys":["$.ip"]},"AggregateOn":"Count"}'
[exit 0]
$ aws cloudwatch describe-insight-rules   -> 200 with the rule
$ aws cloudwatch disable-insight-rules --rule-names probe70-rule   -> 200
$ aws cloudwatch enable-insight-rules --rule-names probe70-rule    -> 200
$ aws cloudwatch get-insight-rule-report --rule-name probe70-rule ...   -> 200
$ aws cloudwatch delete-insight-rules --rule-names probe70-rule    -> 200
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and put an insight rule with the AWS CLI.
2. Open `/aws/cloudwatch/contributor-insights`.
3. The page says there is no screen yet.

## Expected
- The emulator's rules are listed; a rule can be created, enabled, disabled and deleted, and its report read.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Managed insight rules, unless the requirement finds the emulator holds them usefully. Any engine change. Anything sent to real AWS.
