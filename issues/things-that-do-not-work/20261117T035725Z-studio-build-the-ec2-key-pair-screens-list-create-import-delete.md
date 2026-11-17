Issue-Id: 391
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|key-pairs
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 key pair screens: list, create, import, delete

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/key-pairs` and `/aws/ec2/key-pairs/create` (where "Create new key pair" of the launch form leads) show the area's "no screen yet" page. The emulator holds key pairs. `CreateKeyPair` answers with the private key (`KeyMaterial`): Studio shows or offers it once, only when the user asks, and never stores or logs it.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-key-pairs   -> 200, none on a fresh emulator
$ aws ec2 create-key-pair --key-name p73-key --key-type ed25519 --query '[KeyName,KeyPairId,KeyType]'   -> 200
$ aws ec2 describe-key-pairs   -> 200, p73-key
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a key pair with the AWS CLI.
2. Open `/aws/ec2/key-pairs`.
3. The page says there is no screen yet.

## Expected
- The emulator's key pairs are listed; one can be created, imported and deleted.
- The private key of a created pair is given to the user once and is in no storage, log or URL.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
The launch form's key pair choice (issue 73). Any engine change. Anything sent to real AWS.
