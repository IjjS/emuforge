import { describe, expect, it } from 'vitest';

import { followsService, followsTask, followsTasks } from './follow';

describe('the following rule', () => {
  it('a task: PROVISIONING, PENDING, RUNNING, DEACTIVATING → followed; STOPPED → not; not read yet → not', () => {
    for (const lastStatus of ['PROVISIONING', 'PENDING', 'RUNNING', 'DEACTIVATING']) {
      expect(followsTask({ lastStatus }), lastStatus).toBe(true);
    }
    expect(followsTask({ lastStatus: 'STOPPED' })).toBe(false);
    expect(followsTask(undefined)).toBe(false);
  });

  it('a tasks table: "Running" with a task → followed; "Running" and empty → not; "Stopped" with tasks → not', () => {
    expect(followsTasks([{}], 'RUNNING')).toBe(true);
    expect(followsTasks([], 'RUNNING')).toBe(false);
    expect(followsTasks([{}], 'STOPPED')).toBe(false);
  });

  it('a service: ACTIVE and moving → followed; ACTIVE and settled → not; DRAINING or INACTIVE → not', () => {
    expect(followsService({ status: 'ACTIVE', running: 1, desired: 2, deployments: [] })).toBe(true);
    expect(
      followsService({ status: 'ACTIVE', running: 2, desired: 2, deployments: [{ rolloutState: 'IN_PROGRESS' }] }),
    ).toBe(true);
    expect(
      followsService({ status: 'ACTIVE', running: 2, desired: 2, deployments: [{ rolloutState: 'COMPLETED' }] }),
    ).toBe(false);
    for (const status of ['DRAINING', 'INACTIVE']) {
      expect(followsService({ status, running: 1, desired: 2, deployments: [] }), status).toBe(false);
    }
  });
});
