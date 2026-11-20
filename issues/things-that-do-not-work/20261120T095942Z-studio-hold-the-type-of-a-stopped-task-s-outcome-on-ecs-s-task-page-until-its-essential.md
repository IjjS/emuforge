Issue-Id: 616
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|ecs.task-page|outcome-before-revision
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Hold the type of a stopped task's outcome on ECS's task page until its essential containers are known

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
A task's page (S5) tells a stopped task's end in an alert whose type is decided by `stopOutcomeType`: an error for
`TaskFailedToStart`, or for `EssentialContainerExited` with an essential container's exit code other than 0. For a
task of several containers the essential ones are known only once the task's revision is read
(`needsRevision`, `essentialContainers`), and the alert is drawn before that read answers. The impeccable critique of
issue 575 (final r4) read from the code that such a task's alert is shown as info first and turns into an error when
the revision arrives; no seeded task showed it. The page's own stated behaviour (the comment of `stopOutcomeType`) is
one type per stop.

## Evidence
`studio/src/providers/aws/area/services/ecs/pages/task-page.tsx` at `ed00e3ee`: the outcome is drawn as soon as the task
is `STOPPED`, with whatever `revisionContainers` holds then.

```
        {task.lastStatus === 'STOPPED' && (
          <Outcome task={task} essential={essentialContainers(task, revisionContainers)} />
        )}
```

`task-format.ts`: with no essential container known, `nonZero` is false, so the type is `info`.

```
  const nonZero = (essential ?? []).some((container) => container.exitCode !== undefined && container.exitCode !== 0);
  return stopCode === 'EssentialContainerExited' && nonZero ? 'error' : 'info';
```

The critique's finding (final r4): "For a stopped task of several containers the Alert is info until the revision is
read, then error (inferred from the code; no seeded task shows it)".

## Steps to Reproduce
1. Register a task definition of two containers, the essential one ending with exit code 3, and run it on a fresh emulator.
2. When it has stopped (`EssentialContainerExited`), open the task's page with the reads slowed (the browser's network throttling).
3. Watch the alert above the summary while `DescribeTaskDefinition` has not answered yet.

## Expected
- For a stopped task of several containers the outcome's alert is not shown as info and then as an error: until the revision is read it shows no verdict (or is held back), and then the one type its stop code and essential exit codes give.
- A task of one container, and a task whose stop code alone decides (`TaskFailedToStart`, `UserInitiated`), show their outcome at once, as today.

## Out of scope
- The rule of which stops are errors, decided in issue 575.
