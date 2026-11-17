Issue-Id: 351
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|lambda|capacity-providers
Issue-Check-Ids:
Issue-Commit: 4ca29569e47c1758061cad1aefa03f1e144e79c8

# Build the Lambda "Capacity providers" screens

> Identified against commit `4ca29569e47c1758061cad1aefa03f1e144e79c8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/lambda/capacity-providers` shows the area's "no screen yet" page. The emulator holds capacity providers.

Reference: the AWS console's Lambda screens for structure and vocabulary (the owner's captures under `docs/aws-console/lambda/` in the main checkout, outside git, and the AWS Lambda Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the function screens of issue 84 are: `console` screens of the area, a reference spec each under `studio/references/console/lambda/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 84 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0 with the output named, an error is named by its code):

```
$ aws lambda list-capacity-providers   -> ok, empty on a fresh emulator
$ aws lambda create-capacity-provider --capacity-provider-name p84-cp --vpc-config SubnetIds=subnet-00000000,SecurityGroupIds=sg-00000000 --permissions-config CapacityProviderOperatorRoleArn=arn:aws:iam::000000000000:role/p84-role   -> ok, State Pending (the subnet and the security group do not exist)
$ aws lambda get-capacity-provider --capacity-provider-name p84-cp   -> ok
$ aws lambda delete-capacity-provider --capacity-provider-name p84-cp   -> ok, State Deleting
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a capacity provider with the AWS CLI.
2. Open `/aws/lambda/capacity-providers`.
3. The page says there is no screen yet.

## Expected
- The emulator's capacity providers are listed with their state and opened; one can be created and deleted; a state that changes is followed without a reload; the emulator's answer is shown.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether a function runs on a capacity provider of the emulator. VPC screens. Any engine change. Anything sent to real AWS.
