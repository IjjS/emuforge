import { describe, expect, it } from 'vitest';

import { availability, INSTANCE_ACTIONS, isInProgress, READ_AGAIN_MS, statusKind, type InstanceAction } from './status';

const SIX = ['creating', 'starting', 'stopping', 'rebooting', 'modifying', 'deleting'];

const STARTED = 'Only a stopped DB instance can be started.';
const STOPPED = 'Only an available DB instance can be stopped.';
const REBOOTED = 'Only an available DB instance can be rebooted.';
const DELETING = 'This DB instance is already being deleted.';
const AURORA = 'An Aurora DB instance starts and stops only with its DB cluster.';
const PROTECTED = 'Deletion protection is on.';

/** Each action's availability: `true`, or the reason it is not. */
function rules(status: string, engine = 'postgres', deletionProtection = false): Record<InstanceAction, true | string> {
  return Object.fromEntries(
    INSTANCE_ACTIONS.map((action) => {
      const state = availability(action, { status, engine, deletionProtection });
      return [action, state.available ? true : state.reason];
    }),
  ) as Record<InstanceAction, true | string>;
}

describe('a status', () => {
  it('available → success; stopped → stopped; each of the six → in progress; another → no kind', () => {
    expect(statusKind('available')).toBe('success');
    expect(statusKind('stopped')).toBe('stopped');
    for (const status of SIX) {
      expect(statusKind(status), status).toBe('in-progress');
    }
    for (const status of ['failed', 'storage-full', 'incompatible-parameters', 'backing-up']) {
      expect(statusKind(status), status).toBeUndefined();
    }
  });

  it('the six ask for the next read, after 3 seconds; available, stopped and an unknown status do not', () => {
    expect(READ_AGAIN_MS).toBe(3_000);
    for (const status of SIX) {
      expect(isInProgress(status), status).toBe(true);
    }
    for (const status of ['available', 'stopped', 'failed', '']) {
      expect(isInProgress(status), status).toBe(false);
    }
  });
});

describe("an instance's actions", () => {
  it('per status of a postgres instance, which are available and the reason of each other', () => {
    expect(rules('available')).toEqual({ start: STARTED, stop: true, reboot: true, delete: true });
    expect(rules('stopped')).toEqual({ start: true, stop: STOPPED, reboot: REBOOTED, delete: true });
    for (const status of ['creating', 'starting', 'stopping', 'rebooting', 'modifying', 'failed']) {
      expect(rules(status), status).toEqual({ start: STARTED, stop: STOPPED, reboot: REBOOTED, delete: true });
    }
    expect(rules('deleting')).toEqual({ start: STARTED, stop: STOPPED, reboot: REBOOTED, delete: DELETING });
  });

  it('an Aurora engine → "Start" and "Stop" never, with their reason; "Reboot" and "Delete" by the status', () => {
    for (const engine of ['aurora-postgresql', 'aurora-mysql']) {
      expect(rules('available', engine), engine).toEqual({ start: AURORA, stop: AURORA, reboot: true, delete: true });
      expect(rules('stopped', engine), engine).toEqual({ start: AURORA, stop: AURORA, reboot: REBOOTED, delete: true });
    }
  });

  it('deletion protection on → "Delete" unavailable with its reason; on deleting, the status\'s reason', () => {
    expect(rules('available', 'postgres', true).delete).toBe(PROTECTED);
    expect(rules('stopped', 'mysql', true).delete).toBe(PROTECTED);
    expect(rules('deleting', 'postgres', true).delete).toBe(DELETING);
    expect(rules('available', 'postgres', true).stop).toBe(true);
  });
});
