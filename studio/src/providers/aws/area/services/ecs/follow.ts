// The following rule (issue 575, R4, "Following"), written once as pure functions of what was read: a page that
// follows reads what it shows again every 3 seconds while the rule holds. S5 follows its task, S3 and S4 their tasks
// table, S3 its services table and S4 its service.

/** How long after a read a followed part is read again. */
export const FOLLOW_MS = 3_000;

/** What the rule reads of a task. */
export interface FollowedTask {
  lastStatus?: string;
}

/** What the rule reads of a service. */
export interface FollowedService {
  status: string;
  desired?: number;
  running?: number;
  deployments: readonly { rolloutState?: string }[];
}

/** A task is followed until its last status is `STOPPED`, `RUNNING` included; one not read yet is not followed. */
export function followsTask(task: FollowedTask | undefined): boolean {
  return task !== undefined && task.lastStatus !== 'STOPPED';
}

/** A tasks table is followed while it shows "Running" and holds a task on its page. */
export function followsTasks(tasks: readonly unknown[], desiredStatus: string): boolean {
  return desiredStatus === 'RUNNING' && tasks.length > 0;
}

/**
 * A service is followed while it is `ACTIVE` with a running count other than its desired count, or with a deployment
 * `IN_PROGRESS`.
 */
export function followsService(service: FollowedService | undefined): boolean {
  if (service?.status !== 'ACTIVE') {
    return false;
  }
  return (
    service.running !== service.desired ||
    service.deployments.some((deployment) => deployment.rolloutState === 'IN_PROGRESS')
  );
}
