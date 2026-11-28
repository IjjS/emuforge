// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { listAlarms, readAlarm } from './alarms-api';

const endpoint = 'http://127.0.0.1:9682';
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

it('reads an unfiltered page with all three alarm types and 25 records', async () => {
  answer.mockReturnValue(Response.json({}));
  await expect(listAlarms(endpoint, {}, undefined, signal())).resolves.toEqual({ items: [] });
  expect(requests).toEqual([{ operation: 'DescribeAlarms', body: { AlarmTypes: alarmTypes, MaxRecords: 25 } }]);
});

it('sends the prefix, state and page token as given and returns the next token', async () => {
  answer.mockReturnValue(Response.json({ MetricAlarms: [{ AlarmName: ' A-1' }], NextToken: 'page-3' }));
  await expect(listAlarms(endpoint, { prefix: ' A-', state: 'ALARM' }, 'page-2', signal())).resolves.toEqual({
    items: [{ type: 'metric', data: { AlarmName: ' A-1' } }],
    next: 'page-3',
  });
  expect(requests).toEqual([
    {
      operation: 'DescribeAlarms',
      body: {
        AlarmTypes: alarmTypes,
        MaxRecords: 25,
        AlarmNamePrefix: ' A-',
        StateValue: 'ALARM',
        NextToken: 'page-2',
      },
    },
  ]);
});

it('reads an exact name across all three types and returns no alarm when absent', async () => {
  const name = 'x/../? #';
  answer
    .mockReturnValueOnce(Response.json({ LogAlarms: [{ AlarmName: name }] }))
    .mockReturnValueOnce(Response.json({}));
  await expect(readAlarm(endpoint, name, signal())).resolves.toEqual({ type: 'log', data: { AlarmName: name } });
  await expect(readAlarm(endpoint, name, signal())).resolves.toBeUndefined();
  expect(requests).toEqual([
    { operation: 'DescribeAlarms', body: { AlarmTypes: alarmTypes, AlarmNames: [name] } },
    { operation: 'DescribeAlarms', body: { AlarmTypes: alarmTypes, AlarmNames: [name] } },
  ]);
});

it('names DescribeAlarms when either read is refused', async () => {
  answer.mockImplementation(() => Response.json({ __type: 'AccessDenied', message: 'denied' }, { status: 403 }));
  const failure = { failure: { kind: 'access-denied', operation: 'DescribeAlarms', message: 'denied' } };
  await expect(readAlarm(endpoint, 'alarm', signal())).rejects.toMatchObject(failure);
  await expect(listAlarms(endpoint, {}, undefined, signal())).rejects.toMatchObject(failure);
});
