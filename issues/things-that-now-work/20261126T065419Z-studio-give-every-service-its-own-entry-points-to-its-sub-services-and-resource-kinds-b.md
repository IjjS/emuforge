Issue-Id: 650
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|aws-area|service-sub-entry-points
Issue-Check-Ids: studio.aws-entries-navigation-holds-every-entry-of-the-inventory studio.aws-entries-navigation-names-groups-and-marks-entries-without-a-screen studio.aws-entries-entry-with-a-screen-opens-it-from-another-screen studio.aws-entries-kind-without-a-screen-opens-its-page studio.aws-entries-kind-shown-inside-another-says-where studio.aws-entries-kind-listed-inside-a-parent-leads-to-the-parent studio.aws-entries-sub-service-page-links-its-kinds studio.aws-entries-path-below-an-entry-shows-the-generic-page
Issue-Commit: e46981cdff212c94d40ef0b9b5e631c0dc9cd5b5

# Give every service its own entry points to its sub-services and resource kinds, built or not

> Identified against commit `e46981cdff212c94d40ef0b9b5e631c0dc9cd5b5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner said on 2026-11-26: a service's entry holds sub-services and further kinds of resource (EC2: load
balancing, Auto Scaling groups, public IPv4 addresses, security groups; VPC: internet gateways, route tables,
subnets), but a service in Studio opens on the list of its core resource, and what else the service holds is
reached only where an issue happened to build it. Every service's screens are to be enhanced so that each
sub-service and resource kind of the service has an entry point of its own, apart from the core resource; the ways
that lead to them from the core resource's screens stay. A sub-service or resource kind with no screen yet may lead
to a "not built yet" page. How the entries look and where they sit is the worker's to shape and the critique's to
judge; that the entries exist, one per sub-service or resource kind, is the requirement.

What a service's sub-services and resource kinds are comes from the emulator, not from the AWS console's
navigation: the owner expects the emulator's own structure to give the grouping. The harness's probe table
(`.pm/bin/probe-services.json`) already groups the API models a service's entry answers for (for `ec2`: `ec2`,
`elbv2`, `elb`, `autoscaling`), and each model's read operations name its resource kinds. The requirement settles
the source of the list and its grouping, so that a service's entries are derived the same way for every service
and a new service's issue gives its own.

Elastic Load Balancing has no row on the service board and no capture folder of its own; it is a sub-service of
EC2's entry (PM decision of 2026-11-26, with EC2 Auto Scaling groups; the board's "AWS Auto Scaling", issue 107, is
another service). Its screens are issue 400's; this issue gives it its entry.

## Evidence

On `main` at `e46981c`:

- Of the ten core services, only `ec2`, `rds` and `vpc` have a `navigation.ts` under
  `studio/src/providers/aws/area/services/<route>/`; `s3`, `lambda`, `iam`, `dynamodb`, `sqs`, `sns` and `ecs` have
  none.
- `services/ec2/navigation.ts` lists four entries, the ones built: "Instances", "Volumes", "Security groups",
  "Key pairs". Nothing leads to load balancers, target groups, Auto Scaling groups, Elastic IPs, snapshots, images
  or launch templates, although the emulator answers their reads (probe of 2026-11-26 on 1.0.625,
  `.pm/run/probe-services-20261126T065325Z.json`; `aws elbv2 describe-load-balancers` answered 200 while planning
  issue 73, issue 400's evidence).
- `/aws/ec2/load-balancers` shows the area's "no screen yet" page (issue 400), which no entry links to.

## Steps to Reproduce

1. Start EmuForge with a fresh emulator and open `/aws/ec2`.
2. Look for a way to load balancers, Auto Scaling groups or Elastic IPs: there is none.
3. Open `/aws/sqs`, `/aws/s3` or `/aws/lambda`: the service shows its core list and no entry to anything else it
   holds.

## Expected

- Every service with a screen shows an entry for each of its sub-services and resource kinds the emulator's API
  knows, grouped by sub-service, reachable from any screen of the service without going through the core
  resource.
- An entry whose screens are built opens them; an entry whose screens are not built opens a page that says so in
  EmuForge's own words and names the sub-service or resource kind. No entry is a dead link.
- The entries of a service are derived from one stated source in the same way for every service, and a service
  issue that follows adds its own without editing another service's folder.
- EC2 has entries for load balancing (load balancers, target groups, trust stores), Auto Scaling groups, Elastic
  IPs, security groups, key pairs, volumes and the further kinds its models hold; VPC for internet gateways, route
  tables, subnets and the further kinds its model holds.
- The ways that exist today from a core resource's screens to a related resource still work.
- The rule is written where every service issue reads it (`studio/references/`), so a new service is built with its
  entries from the start.
- The changed screens pass the critique (`studio/references/critique.md`).

## Out of scope

Building the screens of a sub-service or resource kind that has none (their own issues, as 400). Any engine change.
Matching the AWS console's navigation. Anything sent to real AWS.
