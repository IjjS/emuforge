// An instance's state as S1 and S3 show it, and what it allows (issue 553, requirement "State and its changes"): the
// state as the API names it, the kind of status it is, whether it still moves by itself, and which of the four
// actions it leaves available.

/** The states the API names, in the order the "State" filter offers them. */
export const INSTANCE_STATES = ['pending', 'running', 'stopping', 'stopped', 'shutting-down', 'terminated'] as const;

export type InstanceState = (typeof INSTANCE_STATES)[number];

/** The kind of status a state is shown with; `undefined` for a state the list does not know. */
export type StateKind = 'success' | 'stopped' | 'in-progress';

const KINDS: Readonly<Record<InstanceState, StateKind>> = {
  pending: 'in-progress',
  running: 'success',
  stopping: 'in-progress',
  stopped: 'stopped',
  'shutting-down': 'in-progress',
  terminated: 'stopped',
};

function isKnown(state: string): state is InstanceState {
  return (INSTANCE_STATES as readonly string[]).includes(state);
}

/** The kind of `state`; none claimed for a state the list does not know. */
export function stateKind(state: string): StateKind | undefined {
  return isKnown(state) ? KINDS[state] : undefined;
}

/** How long until an instance shown in a state that moves by itself is read again. */
export const READ_AGAIN_MS = 3_000;

/** `pending`, `stopping` and `shutting-down` move by themselves, so a page that shows one reads again. */
export function isMoving(state: string): boolean {
  return stateKind(state) === 'in-progress';
}

/** The four actions on one instance. */
export type InstanceAction = 'start' | 'stop' | 'reboot' | 'terminate';

export const INSTANCE_ACTIONS: readonly InstanceAction[] = ['start', 'stop', 'reboot', 'terminate'];

/** Whether an action is available, and when it is not, why. */
export type Availability = { available: true } | { available: false; reason: string };

const AVAILABLE: Availability = { available: true };

const NOT_STOPPED = 'Only a stopped instance can be started.';
const NOT_RUNNING_STOP = 'Only a running instance can be stopped.';
const NOT_RUNNING_REBOOT = 'Only a running instance can be rebooted.';
const SHUTTING_DOWN = 'This instance is already shutting down.';
const TERMINATED = 'This instance is already terminated.';

/** Whether `action` is available on an instance last read in `state`. */
export function availability(action: InstanceAction, state: string): Availability {
  switch (action) {
    case 'start':
      return state === 'stopped' ? AVAILABLE : { available: false, reason: NOT_STOPPED };
    case 'stop':
      return state === 'running' ? AVAILABLE : { available: false, reason: NOT_RUNNING_STOP };
    case 'reboot':
      return state === 'running' ? AVAILABLE : { available: false, reason: NOT_RUNNING_REBOOT };
    case 'terminate':
      if (state === 'shutting-down') {
        return { available: false, reason: SHUTTING_DOWN };
      }
      return state === 'terminated' ? { available: false, reason: TERMINATED } : AVAILABLE;
  }
}
