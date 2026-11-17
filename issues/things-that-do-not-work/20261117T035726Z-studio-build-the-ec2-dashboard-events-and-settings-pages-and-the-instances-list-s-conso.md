Issue-Id: 401
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|dashboard-events-settings-and-list-extras
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Build the EC2 Dashboard, Events and Settings pages, and the Instances list's console-side extras

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's EC2 navigation has "Dashboard", "Events" and "Settings"; their paths show the area's "no screen yet" page. The Instances list of issue 73 also leaves out parts that work on what the console's browser or its user store holds, not on an EC2 operation: "Saved filter sets", client filters and keyword search, the row buttons that filter the table to show or exclude a value, column sorting, and the entry "Migrate a server" of "More actions", which leaves EC2 for another service (issue 73, questions 4 and 12). The requirement says for each whether the emulator holds anything it shows.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 describe-account-attributes   -> 200
$ aws ec2 describe-instance-event-notification-attributes   -> 200
$ aws ec2 get-instance-metadata-defaults   -> 200
$ aws ec2 get-ebs-encryption-by-default   -> 200
$ aws ec2 describe-instances   (no sort parameter in the API; MaxResults and NextToken page it)
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/dashboard`.
3. The page says there is no screen yet.

## Expected
- Each page shows the parts the emulator has; each part it lacks is `omitted` with the emulator's answer.
- A list part is built only where it can work without loading every page into the browser.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
AWS Global View (#163). Any engine change. Anything sent to real AWS.
