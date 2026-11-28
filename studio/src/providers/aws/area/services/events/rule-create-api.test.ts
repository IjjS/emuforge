// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createRule, ruleNameTaken } from './rule-create-api';
import { createRuleInput, INITIAL_RULE_FORM } from './rule-form';

let endpoint: string;
let nextPort = 9980;
const sent: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Response>();
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
    if (new URL(request.url).pathname === '/__emuforge/session') return response({ token: 'emuforge-test-token' });
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it('describes the name on the chosen bus and distinguishes a missing rule from other refusals', async () => {
  answer
    .mockReturnValueOnce(response({ __type: 'ResourceNotFoundException', message: 'Rule route does not exist.' }, 400))
    .mockReturnValueOnce(response({ Name: 'route' }))
    .mockReturnValueOnce(response({ __type: 'ValidationException', message: 'Read refused' }, 400));
  const lookup = () => ruleNameTaken(endpoint, 'orders', 'route', signal());
  await expect(lookup()).resolves.toBe(false);
  await expect(lookup()).resolves.toBe(true);
  await expect(lookup()).rejects.toMatchObject({ failure: { operation: 'DescribeRule', message: 'Read refused' } });
  const request = { operation: 'DescribeRule', body: { Name: 'route', EventBusName: 'orders' } };
  expect(sent).toEqual([request, request, request]);
});

it('sends the built rule and names the operation when refused', async () => {
  const input = createRuleInput({ ...INITIAL_RULE_FORM, name: 'route', pattern: '{"source":["shop"]}' }, 'orders');
  answer
    .mockReturnValueOnce(response({ RuleArn: 'arn:rule' }))
    .mockReturnValueOnce(response({ __type: 'ValidationException', message: 'Pattern refused' }, 400));
  await expect(createRule(endpoint, input, signal())).resolves.toBeUndefined();
  await expect(createRule(endpoint, input, signal())).rejects.toMatchObject({
    failure: { operation: 'PutRule', message: 'Pattern refused' },
  });
  const request = { operation: 'PutRule', body: input };
  expect(sent).toEqual([request, request]);
});
