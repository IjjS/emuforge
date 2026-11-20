Issue-Id: 615
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ecs.tasks-table|column-widths
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Make ECS's tasks table fit at 1280 with Stopped chosen and keep a group whole where it fits

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The tasks table of a cluster's page (S3) and of a service's page (S4) is wider than its container at a 1280 window when
"Desired status" is "Stopped": the impeccable critique of issue 575 (final r4) measured it at 981px in 949px, so
"Stop code" is partly out of view and the column widths jump when the filter changes, against the comment in the
file that says the six columns fit. The same round found the "Group" column breaking `service:` / `queue-` /
`worker` at 390, and after the `:` at 1280 although the value fits. The reference is the area's own rule
(`studio/AGENTS.md`, "What every AWS screen does", entry 4: a value is not broken inside while it fits).

## Evidence
Critique final r4 of issue 575 on `feat/575` `c3a3d43b` (captures of the critic's run, not kept in the repository),
its two findings on `studio/src/providers/aws/area/services/ecs/components/tasks-table.tsx`:

```
- [tasks-table.tsx:46-56] With "Stopped" chosen the tasks table is 981px in 949px at 1280 (Stop code partly hidden,
  column widths jump with the filter), against the comment that it fits
- [tasks-table.tsx:56, :137] Group `calc(10ch + 40px)` breaks `service:` / `queue-` / `worker` at 390 and after `:`
  at 1280 although it fits
```

The widths, at `ed00e3ee`:

```
// The six columns fit at 1280 (949px) in the stopped list too, …
export const TASK_MIN_WIDTH = 'calc(32ch + 24px)';
export const STARTED_AT_MIN_WIDTH = 'calc(12ch + 40px)';
export const GROUP_MIN_WIDTH = 'calc(10ch + 40px)';
```

## Steps to Reproduce
1. On a fresh emulator make a cluster with a service `queue-worker` and tasks that stopped with `EssentialContainerExited`.
2. Open the cluster's page in a 1280 wide window and choose "Stopped" under "Desired status".
3. Measure the table against its container; read the "Group" cells at 1280 and at 390.

## Expected
- At 1280 the tasks table is no wider than its container with "Running" and with "Stopped" chosen, and every column is in view.
- A group such as `service:queue-worker` is on one line where its column has room, and breaks only after its `:`.
- A 32-character task id stays on one line.

## Out of scope
- The columns the table has, and "Stopped at" in the place of "Started at" (recorded as not adopted in issue 575).
