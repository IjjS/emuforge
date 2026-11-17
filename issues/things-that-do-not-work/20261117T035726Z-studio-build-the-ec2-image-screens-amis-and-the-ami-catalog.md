Issue-Id: 394
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|images
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 image screens: AMIs and the AMI Catalog

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
`/aws/ec2/images` and `/aws/ec2/ami-catalog` (where "Browse more AMIs" of the launch form leads) show the area's "no screen yet" page. A fresh emulator holds 62 public images of one Amazon account and none owned by the caller; `CreateImage` answers 501.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-images --max-results 5 --no-paginate   -> 200 with a NextToken (62 images in all)
$ aws ec2 describe-images --owners self   -> 200, none
$ aws ec2 describe-images --image-ids ami-0000000000000ffff   -> 400 InvalidAMIID.NotFound
$ aws ec2 create-image --instance-id <id> --name p73-image   -> 501 NotImplemented (operation CreateImage is scaffolded but not implemented in this emulator)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/images`.
3. The page says there is no screen yet.

## Expected
- The emulator's images are listed with their pages; the catalog shows the public ones.
- "Create image" stays and reports "not implemented by the emulator" while `CreateImage` answers 501.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
EC2 Image Builder (#193). Any engine change. Anything sent to real AWS.
