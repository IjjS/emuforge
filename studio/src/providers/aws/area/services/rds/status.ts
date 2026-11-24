// A DB instance's or DB cluster's status as the screens show it, and what an instance's status allows (issue 573,
// requirement "Status and its changes"): the status as the API names it, the kind it is shown with, whether it still
// moves by itself, and which of an instance's four actions it leaves available, each unavailable one with its reason.

/** The kind of status a status is shown with; `undefined` for any other status. */
export type StatusKind = 'success' | 'stopped' | 'in-progress';

/** The statuses that move by themselves. */
export const IN_PROGRESS_STATUSES = [
  'creating',
  'starting',
  'stopping',
  'rebooting',
  'modifying',
  'deleting',
  'failing-over',
] as const;

/** The kind of `status`; none claimed for a status not named here. */
export function statusKind(status: string): StatusKind | undefined {
  if (status === 'available') {
    return 'success';
  }
  if (status === 'stopped') {
    return 'stopped';
  }
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(status) ? 'in-progress' : undefined;
}

/** How long until a page that shows a status in progress reads again. */
export const READ_AGAIN_MS = 3_000;

/** Whether `status` is one of the statuses that move by themselves, so the page that shows it reads again. */
export function isInProgress(status: string): boolean {
  return statusKind(status) === 'in-progress';
}

/** The four actions on one DB instance. */
export type InstanceAction = 'start' | 'stop' | 'reboot' | 'delete';

export const INSTANCE_ACTIONS: readonly InstanceAction[] = ['start', 'stop', 'reboot', 'delete'];

/** What the rules read of an instance, as it was last read. */
export interface ActionSubject {
  status: string;
  /** The engine as the API names it; absent when the answer gave none. */
  engine?: string | undefined;
  deletionProtection: boolean;
}

/** Whether an action is available, and when it is not, why. */
export type Availability = { available: true } | { available: false; reason: string };

const AVAILABLE: Availability = { available: true };

export const REASONS = {
  notStopped: 'Only a stopped DB instance can be started.',
  notAvailableStop: 'Only an available DB instance can be stopped.',
  notAvailableReboot: 'Only an available DB instance can be rebooted.',
  aurora: 'An Aurora DB instance starts and stops only with its DB cluster.',
  deleting: 'This DB instance is already being deleted.',
  protected: 'Deletion protection is on.',
} as const;

function unavailable(reason: string): Availability {
  return { available: false, reason };
}

/** An engine of Aurora, whose instance starts and stops only with its DB cluster. */
export function isAurora(engine: string | undefined): boolean {
  return engine?.startsWith('aurora') === true;
}

/**
 * Whether `action` is available on `subject`. "Start" and "Stop" are never available for an Aurora engine; "Delete"
 * gives the status's reason before the protection's (plan decision of 2026-11-20).
 */
export function availability(action: InstanceAction, subject: ActionSubject): Availability {
  switch (action) {
    case 'start':
      if (isAurora(subject.engine)) {
        return unavailable(REASONS.aurora);
      }
      return subject.status === 'stopped' ? AVAILABLE : unavailable(REASONS.notStopped);
    case 'stop':
      if (isAurora(subject.engine)) {
        return unavailable(REASONS.aurora);
      }
      return subject.status === 'available' ? AVAILABLE : unavailable(REASONS.notAvailableStop);
    case 'reboot':
      return subject.status === 'available' ? AVAILABLE : unavailable(REASONS.notAvailableReboot);
    case 'delete':
      if (subject.status === 'deleting') {
        return unavailable(REASONS.deleting);
      }
      return subject.deletionProtection ? unavailable(REASONS.protected) : AVAILABLE;
  }
}

/** The DB instance an action is for, as last read. */
export interface ActionTarget extends ActionSubject {
  id: string;
}

/** An action's target from a DB instance as last read. */
export function actionTarget(instance: ActionTarget): ActionTarget {
  return {
    id: instance.id,
    status: instance.status,
    engine: instance.engine,
    deletionProtection: instance.deletionProtection,
  };
}

/** Each action's control. */
export const ACTION_LABELS: Readonly<Record<InstanceAction, string>> = {
  start: 'Start',
  stop: 'Stop',
  reboot: 'Reboot',
  delete: 'Delete',
};

/** What each action's result says was asked ("Stopping {id}"). */
export const ACTION_RESULTS: Readonly<Record<InstanceAction, string>> = {
  start: 'Starting',
  stop: 'Stopping',
  reboot: 'Rebooting',
  delete: 'Deleting',
};
