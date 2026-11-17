Issue-Id: 338
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|dax|clusters-and-groups
Issue-Check-Ids:
Issue-Commit: (no commit yet)

# Build the DAX screens: clusters, subnet groups, parameter groups, events

> Identified against commit `(no commit yet)`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's DynamoDB navigation has a group "DAX" with "Clusters", "Subnet groups", "Parameter groups" and "Events"; Studio has no screen for any of them. The emulator answers the DAX API's lists.

Reference: the AWS console's DynamoDB screens for structure and vocabulary (the owner's captures under `docs/aws-console/dynamodbv2/` in the main checkout, outside git, and the Amazon DynamoDB Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the table screens of issue 72 are: `console` screens of the area, a reference spec each under `studio/references/console/dynamodb/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 72 (the full output was kept in that plan's probe logs):

```
$ aws dax describe-clusters   -> 200, empty
$ aws dax describe-subnet-groups   -> 200
$ aws dax describe-parameter-groups   -> 200
$ aws dax describe-events   -> 200
Not called: create-cluster, create-subnet-group, create-parameter-group.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/dynamodb/dax/clusters`.
3. The page says there is no screen yet.

## Expected
- The requirement finds out by calling which DAX resources the emulator creates and keeps; those are listed, opened, created and deleted in Studio, and a part the emulator does not have is left out with the call that shows it.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether a DAX cluster of the emulator serves requests. Any engine change. Anything sent to real AWS.
