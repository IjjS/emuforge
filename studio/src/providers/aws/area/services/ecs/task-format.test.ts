import { describe, expect, it } from 'vitest';

import type { Task } from './task-api';
import {
  definitionOf,
  essentialContainers,
  lastStatusType,
  needsRevision,
  serviceOfGroup,
  stopOutcomeType,
  taskIdOf,
  taskTexts,
} from './task-format';

describe("a task's values", () => {
  it('a group service:web → the service web; family:web → no service', () => {
    expect(serviceOfGroup('service:web')).toBe('web');
    expect(serviceOfGroup('family:web')).toBeUndefined();
    expect(serviceOfGroup(undefined)).toBeUndefined();
  });

  it("the id is the ARN's last part; the revision is read from the definition's ARN", () => {
    expect(taskIdOf('arn:aws:ecs:us-east-1:000000000000:task/dev/0abc')).toBe('0abc');
    expect(definitionOf('arn:aws:ecs:us-east-1:000000000000:task-definition/web-app:12')).toEqual({
      family: 'web-app',
      revision: 12,
    });
  });

  it('a task with no attachment, no stop code and no start time → each absent value "-"', () => {
    const texts = taskTexts({ id: 'abc', arn: 'arn:aws:ecs:us-east-1:0:task/dev/abc', containers: [] });
    expect(texts.privateIp).toBe('-');
    expect(texts.subnet).toBe('-');
    expect(texts.networkInterface).toBe('-');
    expect(texts.stopCode).toBe('-');
    expect(texts.stoppedReason).toBe('-');
    expect(texts.startedAt).toBe('-');
    expect(texts.stoppedAt).toBe('-');
    expect(Object.values(texts).every((value) => value === '-')).toBe(true);
  });

  it("Last status's indicator: RUNNING success, STOPPED stopped, PENDING pending, DEACTIVATING in progress, other info", () => {
    expect(lastStatusType('RUNNING')).toBe('success');
    expect(lastStatusType('STOPPED')).toBe('stopped');
    expect(lastStatusType('PENDING')).toBe('pending');
    expect(lastStatusType('PROVISIONING')).toBe('pending');
    expect(lastStatusType('DEACTIVATING')).toBe('in-progress');
    expect(lastStatusType(undefined)).toBe('info');
    expect(lastStatusType('ODD')).toBe('info');
  });

  it('the essential containers: one container is its own; of several, those the revision does not mark false', () => {
    const one: Task = { id: 'a', arn: 'a', containers: [{ name: 'app' }] };
    expect(essentialContainers(one, undefined)).toEqual([{ name: 'app' }]);
    const two: Task = {
      id: 'a',
      arn: 'a',
      containers: [
        { name: 'app', exitCode: 3 },
        { name: 'side', exitCode: 1 },
      ],
    };
    expect(essentialContainers(two, undefined)).toBeUndefined();
    expect(essentialContainers(two, [{ name: 'app' }, { name: 'side', essential: false }])).toEqual([
      { name: 'app', exitCode: 3 },
    ]);
    expect(needsRevision({ ...two, lastStatus: 'STOPPED', definition: { family: 'w', revision: 1 } })).toBe(true);
    expect(needsRevision({ ...two, lastStatus: 'RUNNING', definition: { family: 'w', revision: 1 } })).toBe(false);
    expect(needsRevision({ ...one, lastStatus: 'STOPPED', definition: { family: 'w', revision: 1 } })).toBe(false);
  });
});

describe("a stopped task's outcome (critique final r3)", () => {
  it('TaskFailedToStart → error, with or without an exit code', () => {
    expect(stopOutcomeType('TaskFailedToStart', [])).toBe('error');
    expect(stopOutcomeType('TaskFailedToStart', [{ exitCode: 0 }])).toBe('error');
  });

  it('EssentialContainerExited → error only with a non-zero essential exit code', () => {
    expect(stopOutcomeType('EssentialContainerExited', [{ exitCode: 3 }])).toBe('error');
    expect(stopOutcomeType('EssentialContainerExited', [{ exitCode: 0 }])).toBe('info');
    expect(stopOutcomeType('EssentialContainerExited', [{}])).toBe('info');
    expect(stopOutcomeType('EssentialContainerExited', undefined)).toBe('info');
  });

  it("UserInitiated and ServiceSchedulerInitiated → info whatever the exit code, SIGTERM's 143 included", () => {
    expect(stopOutcomeType('UserInitiated', [{ exitCode: 143 }])).toBe('info');
    expect(stopOutcomeType('ServiceSchedulerInitiated', [{ exitCode: 143 }])).toBe('info');
    expect(stopOutcomeType('ServiceSchedulerInitiated', [{ exitCode: 1 }])).toBe('info');
  });

  it('any other stop code → info, even with a non-zero exit code', () => {
    expect(stopOutcomeType('SpotInterruption', [{ exitCode: 137 }])).toBe('info');
    expect(stopOutcomeType(undefined, [{ exitCode: 1 }])).toBe('info');
  });
});
