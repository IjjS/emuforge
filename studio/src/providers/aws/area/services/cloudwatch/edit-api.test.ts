// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { EditableAlarm } from './alarm';
import { alarmEditValues } from './alarm-edit';
import { editAlarm } from './edit-api';

const endpoint = 'http://127.0.0.1:9683';
const name = 'Local  errors /?';
const data = {
  AlarmName: name,
  Namespace: 'App',
  MetricName: 'Errors',
  Statistic: 'Sum',
  EvaluationPeriods: 1,
  Period: 300,
  ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  Threshold: 2,
} as const;
const original: EditableAlarm = { type: 'metric', data };
const lookup = {
  operation: 'DescribeAlarms',
  body: { AlarmNames: [name], AlarmTypes: ['CompositeAlarm', 'MetricAlarm', 'LogAlarm'] },
};
const requests: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Response>();
const submit = () =>
  editAlarm(
    endpoint,
    name,
    original,
    { ...alarmEditValues(name, original), threshold: '5' },
    new AbortController().signal,
  );

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

it('reads immediately before writing merged settings, without tags or a tag request', async () => {
  answer.mockReturnValueOnce(
    Response.json({
      MetricAlarms: [{ ...data, ActionsEnabled: false, Tags: [{ Key: 'Stage', Value: 'local' }] }],
    }),
  );
  await expect(submit()).resolves.toEqual({ kind: 'saved' });
  expect(requests).toEqual([
    lookup,
    { operation: 'PutMetricAlarm', body: { ...data, ActionsEnabled: false, Threshold: 5 } },
  ]);
});

it.each([
  ['gone', {}],
  ['not-editable', { LogAlarms: [{ AlarmName: name }] }],
  ['conflict', { MetricAlarms: [{ ...data, Threshold: 8 }] }],
])('only reads when the outcome is %s', async (kind, response) => {
  answer.mockReturnValueOnce(Response.json(response));
  await expect(submit()).resolves.toMatchObject({ kind });
  expect(requests).toEqual([lookup]);
});

it.each(['DescribeAlarms', 'PutMetricAlarm'])('reports a failure under %s', async (operation) => {
  if (operation === 'PutMetricAlarm') answer.mockReturnValueOnce(Response.json({ MetricAlarms: [data] }));
  answer.mockReturnValueOnce(Response.json({ __type: 'AccessDenied', message: 'Refused' }, { status: 403 }));
  await expect(submit()).rejects.toMatchObject({
    failure: { kind: 'access-denied', message: 'Refused', operation },
  });
  expect(requests.map((item) => item.operation)).toEqual(
    operation === 'DescribeAlarms' ? ['DescribeAlarms'] : ['DescribeAlarms', 'PutMetricAlarm'],
  );
});
