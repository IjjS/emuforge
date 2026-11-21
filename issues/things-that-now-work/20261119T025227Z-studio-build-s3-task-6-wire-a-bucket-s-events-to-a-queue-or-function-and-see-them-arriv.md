Issue-Id: 498
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|s3|bucket-event-notifications
Issue-Check-Ids: studio.s3-notification-queue-receives-upload
Issue-Commit: 5dca87cc1f4351f4e61bff199ef41f16ef2210ef

# Build S3 task 6: wire a bucket's events to a queue or function and see them arrive

> Identified against commit `5dca87cc1f4351f4e61bff199ef41f16ef2210ef`. The code may have drifted since; trace the issue to the current code before fixing.

> Filed by issue 480 (`.pm/issue-480/decisions.md`, PM, 2026-11-18): task 6 of S3's task list
> (`.pm/archive/480/requirement.md` once archived), a later issue in the order 6 to 10.

## Description
A developer wires a bucket's events to an SQS queue (or a Lambda function) to test the app that consumes them.
In Studio, the bucket's Properties (issues 256, 480) show the section "Event notifications" read-only; its
"Create event notification" button leads to the area's "no screen yet" page. Built by the method of
`studio/references/workflow.md`: the task as far as the emulator's API supports it, the calls through the engine, the
states `studio/AGENTS.md` names.

## Evidence
Called on 2026-11-18 while planning issue 480, own emulator on port 9480 (image `aws-emulator` `0414f7370a0f`), the
AWS CLI with the keys it wrote, straight to the emulator (not through the engine's relay); no call answered 501:

```
$ aws s3api put-bucket-notification-configuration (a queue whose policy lets s3.amazonaws.com send)   -> ok, read back with get-bucket-notification-configuration
  the queue received s3:TestEvent, then ObjectCreated:Put for a following put-object
$ aws s3api put-bucket-notification-configuration (a queue without that policy)   -> InvalidArgument "Unable to validate the following destination configurations"
Not called: a Lambda function or SNS topic as the destination, prefix or suffix filters.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; create a bucket and an SQS queue with the AWS CLI.
2. Open `/aws/s3/buckets/<bucket>/properties`.
3. In the section "Event notifications" choose "Create event notification".
4. The page says there is no screen yet.

## Expected
- A notification to a queue (and, as far as the emulator was seen to deliver, a function) is created, edited and
  deleted from the bucket, and read back as the emulator holds it.
- The emulator's refusal of a destination that does not let S3 send is shown as it came, and the screen says in
  EmuForge's own words what the destination lacks.
- A business scenario against the real emulator shows an event that a put caused arriving at the queue.

## Out of scope
Versioning (task 8), the other Properties sections (task 10, issue 447), EventBridge delivery (no longer a task).
