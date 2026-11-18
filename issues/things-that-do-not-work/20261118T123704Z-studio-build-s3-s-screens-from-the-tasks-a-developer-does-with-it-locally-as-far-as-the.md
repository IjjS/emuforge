Issue-Id: 480
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|s3|tasks-by-the-emulator-api
Issue-Check-Ids:
Issue-Commit: 6859ed2abb063e63a71abbc420aa0020bf4a3c48

# Build S3's screens from the tasks a developer does with it locally, as far as the emulator's API supports them

> Identified against commit `6859ed2abb063e63a71abbc420aa0020bf4a3c48`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's pilot of the method of issue 478 (`studio/references/workflow.md`, `aws-area.md`): a service is
what the emulator's API supports of it, broken into the tasks a developer does with it locally, ordered by
importance, built from the top. S3 has screens on `main` today (the bucket list, a bucket's properties, create,
empty, delete; issues 256, 82's kind), built the old way as the console's list, page and create form; what a
developer does with S3 locally is mostly not there: see what an app wrote, open and download an object, upload a
test file, delete objects, find one under a prefix. Open issues hold parts of it (446 a bucket's objects tab and an
object's page, 448 permissions, and others under S3's key).

This issue plans S3 anew: the task list in order, the core marked, and builds from the top what the emulator
supports, keeping what is on `main` where it serves a task and changing it where it does not. The plan writes the
task list first and stops for the owner to read it (the owner's pilot), then goes on.

## Evidence

The owner's decisions of 2026-11-18 (`.pm/archive/478/decisions.md` and issue 478's file). The screens on `main` at
`6859ed2` under `studio/src/providers/aws/area/services/s3/`.

## Steps to Reproduce

Open `/aws/s3` with a bucket the app wrote objects to: the objects cannot be seen.

## Expected

A developer who runs an app against the local emulator can do, in Studio, the service's core tasks from start to
end, each proven by a business scenario against the real emulator.

## Out of scope
