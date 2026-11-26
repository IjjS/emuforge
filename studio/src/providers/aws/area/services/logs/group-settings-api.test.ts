// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { deleteRetentionPolicy, putLogGroupDeletionProtection, saveLogGroupTags } from './group-settings-api';

const endpoint = 'http://127.0.0.1:9949';
const name = '/app#Cold';
const signal = new AbortController().signal;
const headers = { 'content-type': 'application/x-amz-json-1.1' };

afterEach(() => vi.unstubAllGlobals());

function recordRequests(refuse?: string) {
  const sent: { operation: string | undefined; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token' }), { headers });
    }
    const operation = request.headers.get('x-amz-target')?.split('.')[1];
    sent.push({ operation, body: JSON.parse(await request.text()) as unknown });
    return operation === refuse
      ? new Response(JSON.stringify({ __type: 'InvalidParameterException', message: 'Value refused.' }), {
          status: 400,
          headers,
        })
      : new Response('{}', { headers });
  });
  return sent;
}

it('clears retention and sends each value of deletion protection by literal group name', async () => {
  const sent = recordRequests();
  await deleteRetentionPolicy(endpoint, name, signal);
  await putLogGroupDeletionProtection(endpoint, name, true, signal);
  await putLogGroupDeletionProtection(endpoint, name, false, signal);
  expect(sent).toEqual([
    { operation: 'DeleteRetentionPolicy', body: { logGroupName: name } },
    {
      operation: 'PutLogGroupDeletionProtection',
      body: { logGroupIdentifier: name, deletionProtectionEnabled: true },
    },
    {
      operation: 'PutLogGroupDeletionProtection',
      body: { logGroupIdentifier: name, deletionProtectionEnabled: false },
    },
  ]);
});

it('removes keys before writing changed tags and skips each empty step', async () => {
  const sent = recordRequests();
  await saveLogGroupTags(endpoint, name, { remove: ['a'], put: { b: 'changed', c: '' } }, signal);
  await saveLogGroupTags(endpoint, name, { remove: [], put: { c: 'updated' } }, signal);
  await saveLogGroupTags(endpoint, name, { remove: ['b'], put: {} }, signal);
  await saveLogGroupTags(endpoint, name, { remove: [], put: {} }, signal);
  expect(sent).toEqual([
    { operation: 'UntagLogGroup', body: { logGroupName: name, tags: ['a'] } },
    { operation: 'TagLogGroup', body: { logGroupName: name, tags: { b: 'changed', c: '' } } },
    { operation: 'TagLogGroup', body: { logGroupName: name, tags: { c: 'updated' } } },
    { operation: 'UntagLogGroup', body: { logGroupName: name, tags: ['b'] } },
  ]);
});

it('identifies applied removals when the second tag call was refused', async () => {
  const sent = recordRequests('TagLogGroup');
  await expect(
    saveLogGroupTags(endpoint, name, { remove: ['a'], put: { c: 'refused' } }, signal),
  ).rejects.toMatchObject({
    message: 'The tags removed in this save are already removed.',
    cause: { failure: { operation: 'TagLogGroup', message: 'Value refused.' } },
  });
  expect(sent.map(({ operation }) => operation)).toEqual(['UntagLogGroup', 'TagLogGroup']);
});
