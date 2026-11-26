// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { deleteLogGroup } from './group-delete-api';

afterEach(() => vi.unstubAllGlobals());

it('sends the literal group name and identifies the operation in a refusal', async () => {
  const endpoint = 'http://127.0.0.1:9949';
  const name = '/app#Cold';
  const signal = new AbortController().signal;
  const sent: { target: string | null; body: unknown }[] = [];
  const headers = { 'content-type': 'application/x-amz-json-1.1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token' }), { headers });
    }
    sent.push({
      target: request.headers.get('x-amz-target'),
      body: JSON.parse(await request.text()) as unknown,
    });
    return sent.length === 1
      ? new Response('{}', { headers })
      : new Response(JSON.stringify({ __type: 'InvalidParameterException', message: 'Deletion protection is on.' }), {
          status: 400,
          headers,
        });
  });

  await expect(deleteLogGroup(endpoint, name, signal)).resolves.toBeUndefined();
  await expect(deleteLogGroup(endpoint, name, signal)).rejects.toMatchObject({
    failure: {
      kind: 'other',
      operation: 'DeleteLogGroup',
      code: 'InvalidParameterException',
      message: 'Deletion protection is on.',
    },
  });
  const command = { target: 'Logs_20140328.DeleteLogGroup', body: { logGroupName: name } };
  expect(sent).toEqual([command, command]);
});
