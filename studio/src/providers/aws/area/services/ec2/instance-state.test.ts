import { describe, expect, it } from 'vitest';

import { availability, INSTANCE_ACTIONS, INSTANCE_STATES, isMoving, stateKind } from './instance-state';

describe("an instance's state", () => {
  it('running → success; stopped, terminated → stopped; pending, stopping, shutting-down → in progress', () => {
    expect(stateKind('running')).toBe('success');
    expect(stateKind('stopped')).toBe('stopped');
    expect(stateKind('terminated')).toBe('stopped');
    expect(stateKind('pending')).toBe('in-progress');
    expect(stateKind('stopping')).toBe('in-progress');
    expect(stateKind('shutting-down')).toBe('in-progress');
  });

  it('a state the list does not know claims no kind', () => {
    expect(stateKind('hibernating')).toBeUndefined();
    expect(stateKind('')).toBeUndefined();
    expect(isMoving('hibernating')).toBe(false);
  });

  it('pending, stopping, shutting-down ask for the next read; the other three do not', () => {
    expect(INSTANCE_STATES.filter(isMoving)).toEqual(['pending', 'stopping', 'shutting-down']);
  });
});

describe('the actions per state', () => {
  const reasons = (state: string) =>
    Object.fromEntries(
      INSTANCE_ACTIONS.map((action) => {
        const allowed = availability(action, state);
        return [action, allowed.available ? 'available' : allowed.reason];
      }),
    );

  it('running → stop, reboot, terminate', () => {
    expect(reasons('running')).toEqual({
      start: 'Only a stopped instance can be started.',
      stop: 'available',
      reboot: 'available',
      terminate: 'available',
    });
  });

  it('stopped → start, terminate', () => {
    expect(reasons('stopped')).toEqual({
      start: 'available',
      stop: 'Only a running instance can be stopped.',
      reboot: 'Only a running instance can be rebooted.',
      terminate: 'available',
    });
  });

  it('pending and stopping leave "Terminate" alone available', () => {
    for (const state of ['pending', 'stopping']) {
      expect(reasons(state)).toEqual({
        start: 'Only a stopped instance can be started.',
        stop: 'Only a running instance can be stopped.',
        reboot: 'Only a running instance can be rebooted.',
        terminate: 'available',
      });
    }
  });

  it('shutting-down and terminated → nothing, each with a reason of its own for "Terminate"', () => {
    expect(reasons('shutting-down')).toEqual({
      start: 'Only a stopped instance can be started.',
      stop: 'Only a running instance can be stopped.',
      reboot: 'Only a running instance can be rebooted.',
      terminate: 'This instance is already shutting down.',
    });
    expect(reasons('terminated')).toEqual({
      start: 'Only a stopped instance can be started.',
      stop: 'Only a running instance can be stopped.',
      reboot: 'Only a running instance can be rebooted.',
      terminate: 'This instance is already terminated.',
    });
  });
});
