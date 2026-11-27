// @vitest-environment node
import { DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { ListTopicsCommand } from '@aws-sdk/client-sns';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { sendCloudWatch, sendSns } from './clients';

const endpoint = 'http://127.0.0.1:9681';
const answer = vi.fn<(request: Request) => Promise<Response>>();

const cloudWatch = (signal: AbortSignal) =>
  sendCloudWatch(
    endpoint,
    'DescribeAlarms',
    (client, abortSignal) => client.send(new DescribeAlarmsCommand({}), { abortSignal }),
    signal,
  );

const sns = (signal: AbortSignal) =>
  sendSns(
    endpoint,
    'ListTopics',
    (client, abortSignal) => client.send(new ListTopicsCommand({}), { abortSignal }),
    signal,
  );

beforeEach(() => {
  answer.mockReset();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    expect(new URL(request.url).origin).toBe(endpoint);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    return answer(request);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('sends a CloudWatch request through the engine', async () => {
  answer.mockResolvedValue(Response.json({ MetricAlarms: [] }));
  await cloudWatch(new AbortController().signal);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0]?.[0].headers.get('x-amz-target')).toMatch(/\.DescribeAlarms$/);
});

it('sends an SNS request through the engine', async () => {
  answer.mockResolvedValue(
    new Response('<ListTopicsResponse><ListTopicsResult/></ListTopicsResponse>', {
      headers: { 'content-type': 'text/xml' },
    }),
  );
  await sns(new AbortController().signal);
  expect(answer).toHaveBeenCalledOnce();
  const body = await answer.mock.calls[0]?.[0].text();
  expect(new URLSearchParams(body).get('Action')).toBe('ListTopics');
});

const operations = [
  ['DescribeAlarms', cloudWatch],
  ['ListTopics', sns],
] as const;

it.each(operations)('names a failure for %s', async (operation, send) => {
  answer.mockImplementation(async () => new Response(null, { status: 501 }));
  await expect(send(new AbortController().signal)).rejects.toMatchObject({
    failure: { kind: 'not-implemented', operation },
  });
});

it.each(operations)('ends an in-flight %s request on abort', async (_, send) => {
  answer.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  const request = send(controller.signal);
  await vi.waitFor(() => expect(answer).toHaveBeenCalledOnce());
  controller.abort();
  await expect(request).rejects.toBe(controller.signal.reason);
});
