// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PartialTagSaveError, saveBusTags, updateBusDescription } from './bus-settings-api';

let endpoint: string;
let nextPort = 9950;
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

it.each(['New description', ''])('updates the description with only the name and text (%j)', async (description) => {
  answer.mockResolvedValueOnce(response({}));
  await updateBusDescription(endpoint, 'orders', description, signal());
  expect(sent).toStrictEqual([{ operation: 'UpdateEventBus', body: { Name: 'orders', Description: description } }]);
});

const arn = 'arn:orders';
const removal = { operation: 'UntagResource', body: { ResourceARN: arn, TagKeys: ['old'] } };
const put = { operation: 'TagResource', body: { ResourceARN: arn, Tags: [{ Key: 'team', Value: 'local' }] } };

it.each([
  { remove: ['old'], put: { team: 'local' }, expected: [removal, put] },
  { remove: ['old'], put: {}, expected: [removal] },
  { remove: [], put: { team: 'local' }, expected: [put] },
  { remove: [], put: {}, expected: [] },
])('sends only the necessary tag writes in order', async ({ remove, put, expected }) => {
  answer.mockImplementation(() => Promise.resolve(response({})));
  await saveBusTags(endpoint, arn, { remove, put }, signal());
  expect(sent).toStrictEqual(expected);
});

it('names the applied removals and preserves the second operation refusal', async () => {
  answer
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({ __type: 'ValidationException', message: 'Value refused' }, 400));
  const saving = saveBusTags(endpoint, arn, { remove: ['old'], put: { team: 'local' } }, signal());
  await expect(saving).rejects.toBeInstanceOf(PartialTagSaveError);
  await expect(saving).rejects.toMatchObject({
    message: 'The removed tags were saved. The added and changed tags were not.',
    cause: { failure: { operation: 'TagResource', code: 'ValidationException', message: 'Value refused' } },
  });
  expect(sent).toStrictEqual([removal, put]);
});
