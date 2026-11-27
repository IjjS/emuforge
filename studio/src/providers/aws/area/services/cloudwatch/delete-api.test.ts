// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { deleteAlarm } from './delete-api';

afterEach(() => vi.unstubAllGlobals());

it('sends DeleteAlarms with the exact single name and names the operation on refusal', async () => {
  const requests: { operation: string | undefined; body: unknown }[] = [];
  const answer = vi
    .fn<() => Response>()
    .mockReturnValueOnce(Response.json({}))
    .mockReturnValueOnce(
      Response.json({ __type: 'ValidationError', message: 'Composite alarm depends on it' }, { status: 400 }),
    );
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    requests.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
  const endpoint = 'http://127.0.0.1:9682';
  const name = ' alarm  with\nwhitespace ';
  const signal = new AbortController().signal;
  await expect(deleteAlarm(endpoint, name, signal)).resolves.toBeUndefined();
  await expect(deleteAlarm(endpoint, name, signal)).rejects.toMatchObject({
    failure: { operation: 'DeleteAlarms', message: 'Composite alarm depends on it' },
  });
  expect(requests).toEqual([
    { operation: 'DeleteAlarms', body: { AlarmNames: [name] } },
    { operation: 'DeleteAlarms', body: { AlarmNames: [name] } },
  ]);
});
