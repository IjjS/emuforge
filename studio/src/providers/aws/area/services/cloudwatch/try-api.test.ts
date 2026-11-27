// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { setAlarmActions, setAlarmState } from './try-api';

afterEach(() => vi.unstubAllGlobals());

const name = ' an  alarm ';
const endpoint = 'http://127.0.0.1:9683';
const signal = new AbortController().signal;

it.each([
  {
    operation: 'SetAlarmState',
    input: { AlarmName: name, StateValue: 'ALARM', StateReason: 'Try the action' },
    send: () => setAlarmState(endpoint, name, 'ALARM', 'Try the action', signal),
  },
  {
    operation: 'DisableAlarmActions',
    input: { AlarmNames: [name] },
    send: () => setAlarmActions(endpoint, name, false, signal),
  },
  {
    operation: 'EnableAlarmActions',
    input: { AlarmNames: [name] },
    send: () => setAlarmActions(endpoint, name, true, signal),
  },
])('sends $operation with its exact input and names it on refusal', async ({ operation, input, send }) => {
  const requests: { operation: string | undefined; body: unknown }[] = [];
  const answer = vi
    .fn<() => Response>()
    .mockReturnValueOnce(Response.json({}))
    .mockReturnValueOnce(Response.json({ __type: 'ValidationError', message: 'Operation refused' }, { status: 400 }));
  vi.stubGlobal('fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = resource instanceof Request ? resource : new Request(String(resource), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    requests.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });

  await expect(send()).resolves.toBeUndefined();
  await expect(send()).rejects.toMatchObject({ failure: { operation, message: 'Operation refused' } });
  expect(requests).toEqual([
    { operation, body: input },
    { operation, body: input },
  ]);
});
