Issue-Id: 476
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|aws-area|shared-frames-for-list-detail-and-create-screens
Issue-Check-Ids:
Issue-Commit: 9e44be9710d32bfb8fe5c68a1a6c3f562e0fe6f2

# Give the AWS area shared frames for a resource's list, page and create form, and shared checks of them

> Identified against commit `9e44be9710d32bfb8fe5c68a1a6c3f562e0fe6f2`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner asked on 2026-11-18 why the services' screens come so slowly and whether the same thing is written
again for each service. It is. On `main` (`9e44be9`) the area's shared parts
(`studio/src/providers/aws/area/components/`) are about 970 lines, and each service writes the rest for itself:
S3 5114 lines (tests 7789), IAM 4128 (7152), Lambda 3290 (5365). The three list pages
(`services/s3/pages/bucket-list-page.tsx` 696 lines, `services/lambda/pages/function-list-page.tsx` 440,
`services/iam/pages/role-list-page.tsx` 397) each build the same thing by hand: the table with its filter,
pagination, column preferences, selection, header actions, and the loading, empty, no-match and failure states.
The page of one resource (overview, tabs, "not found") and the create form (the fields' rules, tags, submit,
refusal, discard) repeat the same way, and so do the checks: `tests/integration/studio/services/` holds 5745
lines of support in which each service writes again "the list shows what the emulator holds", the keyboard walk,
the layout at 390 wide and the five rules of `studio/AGENTS.md` ("What every AWS screen does").

The reference specs of the nine services planned next name the same three screens each: a list, a resource's
page and a create form (DynamoDB, SQS, SNS, EC2, RDS, VPC, CloudWatch Logs, API Gateway, CloudWatch; issues 72,
79, 78, 73, 245, 282, 71, 69, 70), and each plan cuts nine units for them.

What is wanted: the area owns the frame of each of the three kinds of screen, and a service gives only what is
its own (its calls, its columns and fields, its texts, its actions); the checks of what the frame does are
written once and a service gives them its values. A new service's screens are then a fraction of today's code
and units. S3, Lambda and IAM move onto the frames without a change the user can see.

What the requirement has to settle: what exactly is the same across the built screens and the nine specs and
what is not (a wizard against a one-page form, cards against a table, a dashboard, an editor), so that the frame
covers the common case and does not bend to every exception; how a service departs from the frame where its
console screen differs; how the lint rule against imports between services and the registry of screens stay as
they are; how the existing screens move without their structure scores falling; and how small a service issue's
plan and breakdown become (the owner's aim: fewer units per service).

## Evidence

Line counts on `main` at `9e44be9` (`wc -l` over each service's folder and over `area/components/`). The
reference specs under `.pm/issue-<n>/specs/` of issues 72, 79, 78, 73, 245, 282, 71, 69, 70: three screens each
(API Gateway two create forms, CloudWatch an edit form beside the create form). The four critiques of issue
467 found the same five faults on each service's screens (`.pm/archive/critique-snapshots/`).

## Steps to Reproduce

Read the three list pages side by side.

## Expected

A service issue's implementation gives the area its service's own parts and nothing the frame holds; a list
screen, a resource's page and a create form of a new service need no code for the states, the filter, the
preferences, the keyboard order, the breaking of values or the five rules, and no check written again for them.

## Out of scope
