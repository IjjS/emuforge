Issue-Id: 652
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|ecs.service-checks|emulator-1.0.625
Issue-Check-Ids: studio.ecs-service-made-outside-is-shown-with-its-tasks studio.ecs-update-service-changes-its-count-and-revision studio.ecs-delete-service-removes-it-and-stops-its-tasks
Issue-Commit: 0c61126728831e11f4a5a6832cb140ae88483b27

# ECS service checks fail on emulator 1.0.625: a service does not settle at one running task

> Identified against commit `0c61126728831e11f4a5a6832cb140ae88483b27`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The machine's emulator image moved from 1.0.588 to 1.0.625 on 2026-11-26 and the full checks were run on `main` (`pm-check .`, commit `e46981c`). 426 integration checks passed; six failed, in two groups. On 1.0.588 these checks passed (the whole checks of issues 80 and 83). Whether the emulator's behaviour changed or the checks rely on something it never promised is for the requirement to find by calling the emulator directly. This file is the ECS group: a service made directly in the emulator is expected to settle at one running task, and does not within the checks' wait.

## Evidence

`.pm/run/main-check-1.0.625-integration.log`, lines 752-755:

```
failed  studio.ecs-service-made-outside-is-shown-with-its-tasks  Error: "Running" of the row efit-1795676289-27799-ecssvc-svc reads "1"
error   studio.ecs-update-service-changes-its-count-and-revision  EnvError: environment: service efit-1795676289-27799-ecsupdate-svc did not settle at 1 running
error   studio.ecs-delete-service-removes-it-and-stops-its-tasks  EnvError: environment: service efit-1795676289-27799-ecsdelsvc-svc did not settle at 1 running
```

The other ECS checks of the same run passed, `studio.ecs-create-service-opens-the-created-service` and the task checks among them.

## Steps to Reproduce

1. With the image `aws-emulator` at 1.0.625, run `pm-check . --checks` with the three check ids above.
2. Each fails as in the evidence.

## Expected

- The three checks pass on the machine's emulator image, each asserting what its confirmed scenario says.
- Where the emulator's answer changed, the requirement records the direct calls that show it, and Studio's ECS screens show what the emulator now answers.

## Out of scope

The IAM and Lambda group of the same run (its own issue). Any other ECS work.
