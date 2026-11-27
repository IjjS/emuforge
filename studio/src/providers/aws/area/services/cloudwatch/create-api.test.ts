// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createAlarm } from './create-api';

const endpoint = 'http://127.0.0.1:9683';
const name = 'Local  errors /?';
const input = {
  AlarmName: name,
  Namespace: 'App',
  MetricName: 'Errors',
  Statistic: 'Sum',
  EvaluationPeriods: 1,
  Period: 300,
  ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  Threshold: 2,
} as const;
const lookup = {
  operation: 'DescribeAlarms',
  body: { AlarmNames: [name], AlarmTypes: ['CompositeAlarm', 'MetricAlarm', 'LogAlarm'] },
};
const put = { operation: 'PutMetricAlarm', body: input };
const requests: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Response>();
const submit = () => createAlarm(endpoint, input, new AbortController().signal);

beforeEach(() => {
  requests.length = 0;
  answer.mockReset().mockImplementation(() => Response.json({}));
  vi.stubGlobal('fetch', async (origin: RequestInfo | URL, init?: RequestInit) => {
    const request = origin instanceof Request ? origin : new Request(String(origin), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    requests.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it('looks up the exact name across all three types before sending the input', async () => {
  await expect(submit()).resolves.toBe('created');
  expect(requests).toEqual([lookup, put]);
});

it.each(['MetricAlarms', 'CompositeAlarms', 'LogAlarms'])('stops if %s holds the name', async (kind) => {
  answer.mockReturnValueOnce(Response.json({ [kind]: [{ AlarmName: name }] }));
  await expect(submit()).resolves.toBe('exists');
  expect(requests).toEqual([lookup]);
});

it.each([false, true])('names the failed operation (write reached: %s)', async (write) => {
  if (write) answer.mockReturnValueOnce(Response.json({}));
  answer.mockReturnValueOnce(Response.json({ __type: 'AccessDenied', message: 'Refused' }, { status: 403 }));
  await expect(submit()).rejects.toMatchObject({
    failure: { kind: 'access-denied', message: 'Refused', operation: write ? 'PutMetricAlarm' : 'DescribeAlarms' },
  });
  expect(requests).toEqual(write ? [lookup, put] : [lookup]);
});

it('reads the name afresh on a second submission', async () => {
  await expect(submit()).resolves.toBe('created');
  answer.mockReturnValueOnce(Response.json({ MetricAlarms: [{ AlarmName: name }] }));
  await expect(submit()).resolves.toBe('exists');
  expect(requests).toEqual([lookup, put, lookup]);
});
