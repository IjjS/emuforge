// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readAlarmHistory, readAlarmTags } from './alarm-page-api';

const endpoint = 'http://127.0.0.1:9683';
const alarmTypes = ['CompositeAlarm', 'MetricAlarm', 'LogAlarm'];
const signal = () => new AbortController().signal;
const requests: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Response>();

beforeEach(() => {
  requests.length = 0;
  answer.mockReset();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    requests.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it('reads history by name across types, maps the items, and follows the supplied token', async () => {
  const time = new Date('2026-11-27T00:00:00Z');
  answer
    .mockReturnValueOnce(
      Response.json({
        AlarmHistoryItems: ['ConfigurationUpdate', 'StateUpdate', 'Action'].map((type) => ({
          Timestamp: time.getTime() / 1000,
          HistoryItemType: type,
          HistorySummary: type + ' summary',
        })),
        NextToken: 'page-2',
      }),
    )
    .mockReturnValueOnce(Response.json({}));
  const name = 'alarm + name';
  await expect(readAlarmHistory(endpoint, name, undefined, signal())).resolves.toEqual({
    items: [
      { time, type: 'Configuration', summary: 'ConfigurationUpdate summary' },
      { time, type: 'State', summary: 'StateUpdate summary' },
      { time, type: 'Action', summary: 'Action summary' },
    ],
    next: 'page-2',
  });
  await expect(readAlarmHistory(endpoint, name, 'page-2', signal())).resolves.toEqual({ items: [] });
  const body = { AlarmName: name, AlarmTypes: alarmTypes, MaxRecords: 25 };
  expect(requests).toEqual([
    { operation: 'DescribeAlarmHistory', body },
    { operation: 'DescribeAlarmHistory', body: { ...body, NextToken: 'page-2' } },
  ]);
});

it('reads tags using the ARN verbatim', async () => {
  const arn = 'arn:aws:cloudwatch:us-east-1:000000000000:alarm:name + #';
  const tags = [{ Key: 'project', Value: '' }];
  answer.mockReturnValueOnce(Response.json({ Tags: tags }));
  await expect(readAlarmTags(endpoint, arn, signal())).resolves.toEqual(tags);
  expect(requests).toEqual([{ operation: 'ListTagsForResource', body: { ResourceARN: arn } }]);
});

it('names the operation for each read that is refused', async () => {
  answer.mockImplementation(() => Response.json({ __type: 'AccessDenied', message: 'denied' }, { status: 403 }));
  await expect(readAlarmHistory(endpoint, 'name', undefined, signal())).rejects.toMatchObject({
    failure: { kind: 'access-denied', operation: 'DescribeAlarmHistory', message: 'denied' },
  });
  await expect(readAlarmTags(endpoint, 'arn', signal())).rejects.toMatchObject({
    failure: { kind: 'access-denied', operation: 'ListTagsForResource', message: 'denied' },
  });
});
