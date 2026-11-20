import { describe, expect, it } from 'vitest';

import { definitionOf, serviceOfGroup, taskIdOf, taskTexts } from './task-format';

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
});
