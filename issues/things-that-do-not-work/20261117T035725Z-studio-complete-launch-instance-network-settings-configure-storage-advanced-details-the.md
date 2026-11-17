Issue-Id: 389
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|ec2|launch-instance-rest
Issue-Check-Ids:
Issue-Commit: e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb

# Complete Launch instance: Network settings, Configure storage, Advanced details, the AMI tabs

> Identified against commit `e4f7ab7a7b4fdbf7eeada9fab2f378919214bfeb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The launch form of issue 73 shows the sections "Network settings", "Configure storage" and "Advanced details" as titled containers without controls and sends none of their settings. The user guide names their fields: "VPC", "Subnet", "Auto-assign public IP", "Firewall (security groups)"; the root volume and further volumes; "Shutdown behavior", "Termination protection", "Stop protection", "Detailed CloudWatch monitoring", "User data" and more. The form also has one list of images in place of the AMI tabs "Recents", "My AMIs" and "Quick Start", no "Get advice", and puts every additional tag on the instance without the guide's choice of a resource type (issue 73, questions 6 and 11). This issue's `t` unit adds the fields to `studio/references/console/ec2/launch-instance.yaml`.

Reference: the AWS console's EC2 screens for structure and vocabulary (the owner's captures under `docs/aws-console/ec2/` in the main checkout, outside git, and the Amazon EC2 User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the instance screens of issue 73 are: `console` screens of the area, a reference spec each under `studio/references/console/ec2/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 73:

```
$ aws ec2 run-instances --image-id <ami> --instance-type t3.small --count 3 --key-name p73-key --security-group-ids <sg> --subnet-id <subnet in us-east-1b> --disable-api-termination --disable-api-stop --monitoring Enabled=true --instance-initiated-shutdown-behavior terminate --user-data 'echo hi' ...
-> 200; read back: the security group, the subnet and its zone, Monitoring enabled, both protections true, shutdown behavior terminate, the user data
$ aws ec2 run-instances ... --security-group-ids sg-0000000000000ffff   -> 400 InvalidGroup.NotFound
$ aws ec2 run-instances ... --subnet-id subnet-0000000000000ffff   -> 200 (an instance without a network interface)
$ aws ec2 run-instances ... --instance-type t3.small --subnet-id <subnet in us-east-1c>   -> 400 Unsupported
$ aws ec2 describe-images --owners self   -> 200, none on a fresh emulator
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/ec2/instances/launch`.
3. "Network settings", "Configure storage" and "Advanced details" say Studio has no controls for these settings yet.

## Expected
- The three sections have the console's fields and the launch sends them; the emulator's refusal (an unknown security group, a type the zone does not offer) is shown as it came.
- The AMI choice has the console's tabs; a tag can be given a resource type.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Key pairs, security groups and the AMI catalog as screens of their own. Any engine change. Anything sent to real AWS.
