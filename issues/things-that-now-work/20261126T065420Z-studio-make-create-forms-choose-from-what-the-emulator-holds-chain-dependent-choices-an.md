Issue-Id: 651
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|aws-area|create-form-choices-and-option-help
Issue-Check-Ids: studio.rds-create-instance-chooses-class-storage-and-placement studio.rds-cluster-forms-choose-from-the-emulator studio.rds-modify-instance-follows-its-parents studio.rds-modify-cluster-version-storage-and-groups studio.rds-snapshot-forms-tag-and-restore-into-a-chosen-network studio.ec2-launch-and-retype-follow-the-vpc-and-the-zone studio.ec2-group-rule-and-key-pair-forms-describe-and-tag studio.ec2-volume-forms-choose-type-snapshot-key-and-instance studio.vpc-create-forms-describe-and-tag studio.vpc-route-table-forms-choose-targets-and-subnets studio.vpc-attach-offers-only-free-vpcs
Issue-Commit: e46981cdff212c94d40ef0b9b5e631c0dc9cd5b5

# Make create forms choose from what the emulator holds, chain dependent choices and explain each option

> Identified against commit `e46981cdff212c94d40ef0b9b5e631c0dc9cd5b5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner said on 2026-11-26 that creating a resource in Studio is thin: it is not clear that a create form takes
everything the resource needs, the forms hardly connect one service to another, and the options are not explained.
The owner's examples: the DB instance class of an RDS instance is typed as a string where it should be chosen from
a list; and a subnet for an EC2 instance should be chosen after its VPC, the VPC narrowing the subnets offered. Each
option of a create form should carry at least a short description.

What is wanted, for every create form of the built services and as the rule for every service that follows:

- A field whose values are a known set (a class, a type, an engine, a version, a zone, a storage type) is a choice,
  not typed text. The set comes from the emulator where it has an operation that lists it, otherwise from the
  service's API model; a value the emulator would refuse is not offered as if it worked.
- A field that names a resource the emulator holds, of the same service or another (a VPC, a subnet, a security
  group, a key, a role, a queue, a topic, a bucket, a log group), is chosen from what the emulator holds now, read
  through the engine when the field opens, and never typed as an identifier alone.
- A choice that depends on another is narrowed by it: the parent is chosen first and the child offers only what
  belongs to it (subnets of the chosen VPC, security groups of that VPC, versions of the chosen engine), and a
  change of the parent clears a child that no longer belongs.
- Each option has a short description of what it does locally, in EmuForge's own words.
- For each create form the requirement compares the form's fields with the parameters the create operation takes
  and the emulator honours, and states for each parameter left out why it is left out.

## Evidence

On `main` at `e46981c`:

- `studio/src/providers/aws/area/services/rds/components/create-fields.tsx`, `ClassField` ("DB instance class",
  commented "typed as the API names it") is a `TextInput`; the same field is used by
  `components/modify-instance-dialog.tsx`.
- `studio/src/providers/aws/area/services/ec2/pages/launch-instance-page.tsx` offers a subnet with no VPC chosen
  first; the VPC is known only as the chosen subnet's (`form.subnet?.vpcId`), which then narrows the security
  groups.
- No reference under `studio/references/` states which fields of a create form are choices, how a dependent choice
  behaves or that an option is described, so each service's form decided it for itself.

## Steps to Reproduce

1. Start EmuForge with a fresh emulator and open the RDS create instance form: the DB instance class is a text
   box.
2. Open EC2's launch instance form: the subnet field lists the subnets of every VPC, and there is no VPC field.

## Expected

- The RDS DB instance class, on create and on modify, is chosen from a list, and so is every other field of a
  built create form whose values are a known set.
- EC2's launch form takes a VPC and offers the subnets of that VPC; changing the VPC clears a subnet and groups of
  another VPC. Every other dependent pair of the built create forms behaves the same way.
- Every field that names a resource of the emulator lists what the emulator holds, resources made outside Studio
  included, read through the engine and never from a browser cache.
- Every option of a built create form shows a short description.
- For each built create form, the requirement's table of the create operation's parameters shows each as offered
  or as left out with its reason, and what was missing and is honoured by the emulator is added.
- The rule is written where every service issue reads it (`studio/references/`), so a new service's create forms
  are built this way from the start.
- The changed forms pass the critique (`studio/references/critique.md`).

## Out of scope

New screens other than create and modify forms. Any engine change. Matching the AWS console's forms field for
field. Anything sent to real AWS.
