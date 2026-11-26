Issue-Id: 657
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|ecs.starter-definition|sleep-no-longer-keeps-a-task-running
Issue-Check-Ids: studio.ecs-starter-registers-runs-and-logs
Issue-Commit: b30f580e277940803854843b7692df685d0a8090

# Make the ECS starter task definition and its description true on emulator 1.0.625: a finite sleep no longer keeps a task running

> Identified against commit `b30f580e277940803854843b7692df685d0a8090`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

"Register task definition" of Studio's ECS screens starts from a text whose container command is
`sh -c "echo hello from EmuForge Studio; sleep 3600"` (`studio/src/providers/aws/area/services/ecs/register-form.ts`),
and the field's description says that a `sleep` "keeps the task running"
(`studio/src/providers/aws/area/services/ecs/pages/register-page.tsx`). On emulator 1.0.533, where the screens were
built (issue 575), a task of that command stayed `RUNNING`. On emulator 1.0.625 a `sleep` of a number of seconds is
played as ending at once: the task is `DEACTIVATING` about 3 seconds after it reaches `RUNNING` and `STOPPED` about 4
seconds after, with exit code 0. A command that does not end by itself (`sleep infinity`, `tail -f /dev/null`) and a
container with no command keep the task `RUNNING`. The reference is the same request sent straight to aws-emulator.

So the starter a developer registers and runs from Studio stops within seconds, and the screen states something the
emulator no longer does (`studio/references/aws-area.md`: a claim about the emulator's behavior needs a check that
shows it). The check that shows it, `studio.ecs-starter-registers-runs-and-logs`, asserts that the task's last
status "becomes Running and stays so after its log shows the line"; it passed on 1.0.625 in the run of 2026-11-26,
but only because it read the task inside those 3 seconds, so it can fail by timing. Found while fixing issue 652,
whose checks seeded the same `sleep 3600`.

`studio.ecs-task-whose-command-ends-is-followed-to-stopped` is touched by the same change: its command's `sleep 20`
is no longer waited, which leaves about 3 seconds for the state in between that its line is about. It passed in the
same run.

## Evidence

Direct calls to aws-emulator 1.0.625 (commit `31a69969`) with the AWS CLI on 2026-11-26, `RunTask` of a Fargate
definition whose one essential container has the command shown, `lastStatus` read at each change, seconds since
`RunTask` (the plan's probe of issue 652, `ecs-1.0.625-commands.txt` and `ecs-1.0.625-exact.txt`):

```
command ["sh","-c","echo hello; sleep 3600"]
  t+0.4s  PROVISIONING
  t+1.4s  PENDING
  t+2.3s  RUNNING
  t+5.3s  DEACTIVATING  EssentialContainerExited  exit code 0
  t+6.4s  STOPPED       EssentialContainerExited  exit code 0
command ["sh","-c","sleep 3600"]
  t+2.2s  RUNNING
  t+4.9s  DEACTIVATING  EssentialContainerExited  exit code 0
  t+6.8s  STOPPED       EssentialContainerExited  exit code 0
command ["sh","-c","echo start; sleep 20; echo done; exit 3"]
  t+2.3s  RUNNING
  t+5.4s  DEACTIVATING  EssentialContainerExited  exit code 3
  t+6.4s  STOPPED       EssentialContainerExited  exit code 3
command ["sh","-c","sleep infinity"]
  t+2.3s  RUNNING, and still RUNNING at the last of 30 reads
```

The starter's text: `register-form.ts`, line 24, `"command": ["sh", "-c", "echo hello from EmuForge Studio; sleep 3600"]`.
The description: `register-page.tsx`, line 46, "…and a `sleep` keeps the task running."

## Steps to Reproduce

1. Start aws-emulator 1.0.625 and Studio; create a cluster.
2. Open "Register task definition", change only the family and the log group, and "Register".
3. "Run task" in the cluster with that revision, one subnet and the public IP box checked.
4. The task's page shows "Running" and, a few seconds later, "Stopped" with stop code `EssentialContainerExited`.

## Expected

- A task of the starter definition, registered and run from Studio as it starts, stays `RUNNING` on the machine's
  emulator until it is stopped, and its log shows the starter's line.
- The description of the field says only what the emulator does with a command, and a check shows it.
- `studio.ecs-starter-registers-runs-and-logs` passes without depending on when it reads the task.

## Out of scope

The ECS checks' own definition made outside (issue 652). Whether `studio.ecs-task-whose-command-ends-is-followed-to-stopped`
needs another command to keep its state in between is for this issue's requirement to find.
