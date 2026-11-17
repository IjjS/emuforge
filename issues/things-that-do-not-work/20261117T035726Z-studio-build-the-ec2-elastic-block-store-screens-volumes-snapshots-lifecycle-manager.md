Issue-Id: 393
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|ebs
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Elastic Block Store screens: Volumes, Snapshots, Lifecycle Manager

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/volumes`, `/aws/ec2/snapshots` and the Lifecycle Manager's path show the area's "no screen yet" page. The emulator holds volumes (every launched instance has a root volume), and its snapshot and Data Lifecycle Manager lists answer.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-volumes   -> 200; after launches: one 8 GiB volume per instance, in-use, attached
$ aws ec2 describe-snapshots --owner-ids self   -> 200, none
$ aws ec2 get-ebs-encryption-by-default   -> 200
$ aws dlm get-lifecycle-policies   -> 200, none
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and launch an instance.
2. Open `/aws/ec2/volumes`.
3. The page says there is no screen yet.

## Expected
- The emulator's volumes and snapshots are listed with their pages; create, attach, detach and delete do their work or report the emulator's answer.
- Lifecycle Manager is built if the requirement finds the emulator can hold a policy, and `omitted` with its evidence otherwise.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
An instance's "Storage" tab. Any engine change. Anything sent to real AWS.
