Issue-Id: 326
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|logs|deliveries-and-the-rest
Issue-Check-Ids:
Issue-Commit: 13dbdefb1fbda957737b6b2390491c5044dad104

# Build the remaining CloudWatch Logs screens: deliveries, destinations, export tasks, resource policies, index policies, transformers, integrations, lookup tables, scheduled queries

> Identified against commit `13dbdefb1fbda957737b6b2390491c5044dad104`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Beyond log groups and the groups of resources filed with them, the emulator answers the rest of the CloudWatch Logs API: deliveries with their sources and destinations, destinations, export tasks, resource policies, field index policies, transformers, integrations, lookup tables, scheduled queries and the account policies. Studio has no screen for any of them. They were called with an empty body or a read only, so what each holds is for this issue's requirement to find; it cuts the work into further issues where one is too large.

Reference: the AWS console's CloudWatch Logs screens for structure and vocabulary (the owner's captures under `docs/aws-console/cloudwatch/` in the main checkout, outside git, and the Amazon CloudWatch Logs User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the log group screens of issue 71 are: `console` screens of the area, a reference spec each under `studio/references/console/logs/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 71:

```
sweep with an empty body (probe-1-sweep.log), none answered 501:
200  DescribeDeliveries {"deliveries":[]}   200  DescribeDeliverySources   200  DescribeDeliveryDestinations
200  DescribeDestinations {"destinations":[]}   200  DescribeExportTasks {"exportTasks":[]}
200  DescribeResourcePolicies {"resourcePolicies":[]}   200  ListIntegrations   200  DescribeLookupTables   200  ListScheduledQueries
400  CreateDelivery / PutDestination / CreateExportTask / PutIndexPolicy / PutTransformer / CreateLookupTable / CreateScheduledQuery: each a validation error for the missing member
$ aws logs describe-index-policies --log-group-identifiers p71-a-standard   -> 200, {"indexPolicies":[]}
$ aws logs get-transformer --log-group-identifier p71-a-standard   -> 200
$ aws logs describe-account-policies --policy-type SUBSCRIPTION_FILTER_POLICY   -> 200, {"accountPolicies":[]}
$ aws logs put-account-policy --policy-type RETENTION_POLICY …
InvalidParameterException … 'policyType' failed to satisfy constraint (the type is not in the emulator's set)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open any path below `/aws/logs` other than the log group screens.
3. The page says there is no screen yet.

## Expected
- Each of these groups of resources the emulator really holds (found by calling it with real arguments) has its list, and create, update and delete where the API has them; an operation answered 501 is shown as "not implemented".
- The list's column "Account retention policy" stays out while the emulator refuses the policy type `RETENTION_POLICY`; the requirement probes it again.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Everything filed as its own issue from issue 71. Any engine change. Anything sent to real AWS.
