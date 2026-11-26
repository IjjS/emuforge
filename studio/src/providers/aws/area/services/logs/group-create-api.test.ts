// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { createLogGroup, putRetentionPolicy } from './group-create-api';
import { createGroupInput, INITIAL_GROUP_FORM } from './group-form';

afterEach(() => vi.unstubAllGlobals());

it('sends the built create input and writes retention with the group name and days', async () => {
  const sent: { operation: string | undefined; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const session = new URL(request.url).pathname === '/__emuforge/session';
    if (!session) {
      sent.push({
        operation: request.headers.get('x-amz-target')?.split('.').at(-1),
        body: JSON.parse(await request.text()) as unknown,
      });
    }
    return new Response(JSON.stringify(session ? { token: 'emuforge-test-token' } : {}), {
      headers: { 'content-type': 'application/x-amz-json-1.1' },
    });
  });

  const endpoint = 'http://127.0.0.1:9941';
  const signal = new AbortController().signal;
  const input = createGroupInput({
    ...INITIAL_GROUP_FORM,
    name: '/app#new',
    retention: 7,
    deletionProtection: true,
    tags: [{ key: 'team', value: 'core' }],
  });
  await createLogGroup(endpoint, input, signal);
  await putRetentionPolicy(endpoint, '/app#new', 7, signal);
  expect(sent).toEqual([
    { operation: 'CreateLogGroup', body: input },
    { operation: 'PutRetentionPolicy', body: { logGroupName: '/app#new', retentionInDays: 7 } },
  ]);
});
