// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getRule, listRules, listRuleTargets } from './rule-api';

let endpoint: string;
let nextPort = 9940;
const sent: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Promise<Response>>();
const signal = () => new AbortController().signal;

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  endpoint = `http://127.0.0.1:${String(nextPort++)}`;
  sent.length = 0;
  answer.mockReset();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return response({ token: 'emuforge-test-token' });
    }
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it('reads one page of the named bus’s rules with limit, token and optional prefix', async () => {
  const rule = {
    Name: 'route',
    Arn: 'arn:rule',
    State: 'ENABLED',
    EventPattern: '{}',
    ScheduleExpression: 'rate(5 minutes)',
    Description: 'Orders',
  };
  const minimal = { Name: 'route2' };
  answer
    .mockResolvedValueOnce(response({ Rules: [rule], NextToken: 'after' }))
    .mockResolvedValueOnce(response({ Rules: [minimal] }));
  await expect(listRules(endpoint, 'default', 'Route', 'before', signal())).resolves.toStrictEqual({
    items: [rule],
    next: 'after',
  });
  await expect(listRules(endpoint, 'default', '', undefined, signal())).resolves.toStrictEqual({ items: [minimal] });
  expect(sent).toEqual([
    { operation: 'ListRules', body: { EventBusName: 'default', Limit: 25, NamePrefix: 'Route', NextToken: 'before' } },
    { operation: 'ListRules', body: { EventBusName: 'default', Limit: 25 } },
  ]);
});

it('describes the named rule on its bus and preserves optional members', async () => {
  const basic = {
    Name: 'route',
    Arn: 'arn:rule',
    State: 'DISABLED',
    EventBusName: 'orders',
    CreatedBy: '000000000000',
  };
  const extended = { ...basic, Description: 'Orders', EventPattern: '{}', RoleArn: 'arn:role' };
  answer.mockResolvedValueOnce(response(extended)).mockResolvedValueOnce(response(basic));
  await expect(getRule(endpoint, 'orders', 'route', signal())).resolves.toStrictEqual({
    kind: 'found',
    rule: extended,
  });
  await expect(getRule(endpoint, 'orders', 'route', signal())).resolves.toStrictEqual({ kind: 'found', rule: basic });
  expect(sent).toEqual([
    { operation: 'DescribeRule', body: { EventBusName: 'orders', Name: 'route' } },
    { operation: 'DescribeRule', body: { EventBusName: 'orders', Name: 'route' } },
  ]);
});

it('keeps the message of a missing rule and rejects other refusals', async () => {
  const message = 'Rule route does not exist on EventBus orders.';
  answer
    .mockResolvedValueOnce(response({ __type: 'ResourceNotFoundException', message }, 400))
    .mockResolvedValueOnce(response({ __type: 'ValidationException', message: 'Invalid rule' }, 400));
  await expect(getRule(endpoint, 'orders', 'route', signal())).resolves.toEqual({ kind: 'not-found', message });
  await expect(getRule(endpoint, 'orders', 'route', signal())).rejects.toMatchObject({
    failure: { kind: 'other', operation: 'DescribeRule', code: 'ValidationException', message: 'Invalid rule' },
  });
});

it('follows every target page and keeps the members and order of the answers', async () => {
  const first = {
    Id: 'queue',
    Arn: 'arn:queue',
    Input: '{"source":"local"}',
    SqsParameters: { MessageGroupId: 'orders' },
  };
  const second = { Id: 'topic', Arn: 'arn:topic', InputPath: '$.detail' };
  const third = { Id: 'logs', Arn: 'arn:logs', RetryPolicy: { MaximumRetryAttempts: 2 } };
  answer
    .mockResolvedValueOnce(response({ Targets: [first], NextToken: 'second' }))
    .mockResolvedValueOnce(response({ Targets: [], NextToken: 'third' }))
    .mockResolvedValueOnce(response({ Targets: [second, third] }));
  await expect(listRuleTargets(endpoint, 'orders', 'route', signal())).resolves.toStrictEqual([first, second, third]);
  expect(sent).toEqual([
    { operation: 'ListTargetsByRule', body: { EventBusName: 'orders', Rule: 'route' } },
    { operation: 'ListTargetsByRule', body: { EventBusName: 'orders', Rule: 'route', NextToken: 'second' } },
    { operation: 'ListTargetsByRule', body: { EventBusName: 'orders', Rule: 'route', NextToken: 'third' } },
  ]);
});
