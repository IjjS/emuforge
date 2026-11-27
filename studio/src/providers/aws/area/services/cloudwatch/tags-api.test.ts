// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { saveAlarmTags } from './tags-api';

afterEach(() => vi.unstubAllGlobals());

const endpoint = 'http://127.0.0.1:9683';
const arn = 'arn:aws:cloudwatch:us-east-1:123456789012:alarm: an  alarm @/';
const signal = new AbortController().signal;
const remove = ['old'];
const put = [{ key: 'new', value: '' }];
const untag = { operation: 'UntagResource', body: { ResourceARN: arn, TagKeys: remove } };
const tag = { operation: 'TagResource', body: { ResourceARN: arn, Tags: [{ Key: 'new', Value: '' }] } };

function intercept(answers: Record<string, () => Response | Promise<Response>> = {}) {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')!.split('.').at(-1)!;
    sent.push({ operation, body: (await request.json()) as unknown });
    return answers[operation]?.() ?? Response.json({});
  });
  return sent;
}

it('waits for the removal to answer before sending additions, passing the ARN unchanged', async () => {
  let finishRemoval!: (answer: Response) => void;
  let startRemoval!: () => void;
  const started = new Promise<void>((resolve) => {
    startRemoval = resolve;
  });
  const answer = new Promise<Response>((resolve) => {
    finishRemoval = resolve;
  });
  const sent = intercept({
    UntagResource: () => {
      startRemoval();
      return answer;
    },
  });
  const saving = saveAlarmTags(endpoint, arn, { remove, put }, signal);
  await started;
  expect(sent).toEqual([untag]);
  finishRemoval(Response.json({}));
  await saving;
  expect(sent).toEqual([untag, tag]);
});

it.each([
  { remove, put: [], expected: [untag] },
  { remove: [], put, expected: [tag] },
  { remove: [], put: [], expected: [] },
])('sends only the owed calls ($expected.length)', async ({ remove, put, expected }) => {
  const sent = intercept();
  await saveAlarmTags(endpoint, arn, { remove, put }, signal);
  expect(sent).toEqual(expected);
});

it.each([
  { operation: 'UntagResource', removalsSaved: false, expected: [untag] },
  { operation: 'TagResource', removalsSaved: true, expected: [untag, tag] },
])(
  'names the $operation refusal and records whether removals were saved',
  async ({ operation, removalsSaved, expected }) => {
    const sent = intercept({
      [operation]: () => Response.json({ __type: 'ValidationError', message: 'Tag change refused.' }, { status: 400 }),
    });
    await expect(saveAlarmTags(endpoint, arn, { remove, put }, signal)).rejects.toMatchObject({
      operation,
      removalsSaved,
      cause: { failure: { operation, message: 'Tag change refused.' } },
    });
    expect(sent).toEqual(expected);
  },
);
