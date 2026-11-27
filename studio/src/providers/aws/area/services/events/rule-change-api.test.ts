// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deleteRule, removeRuleTarget, setRuleEnabled } from './rule-change-api';

let endpoint: string;
let nextPort = 9960;
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

const ruleInput = { EventBusName: 'orders', Name: 'route' };
const targetInput = { EventBusName: 'orders', Rule: 'route' };
const refused = (message: string) => response({ __type: 'ValidationException', message }, 400);

function remove(id: string) {
  return removeRuleTarget(endpoint, 'orders', 'route', id, signal());
}

function drop() {
  return deleteRule(endpoint, 'orders', 'route', signal());
}

it('enables and disables the named rule on its bus', async () => {
  answer.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({}));
  await setRuleEnabled(endpoint, 'orders', 'route', true, signal());
  await setRuleEnabled(endpoint, 'orders', 'route', false, signal());
  expect(sent).toEqual([
    { operation: 'EnableRule', body: ruleInput },
    { operation: 'DisableRule', body: ruleInput },
  ]);
});

it('removes the selected ID and treats a failed entry as a refusal', async () => {
  const entry = { TargetId: 'queue', ErrorCode: 'Refused', ErrorMessage: 'Queue target could not be removed' };
  answer
    .mockResolvedValueOnce(response({ FailedEntryCount: 0 }))
    .mockResolvedValueOnce(response({ FailedEntryCount: 1, FailedEntries: [entry] }));
  await remove('queue');
  await expect(remove('queue')).rejects.toMatchObject({
    failure: { operation: 'RemoveTargets', code: entry.ErrorCode, message: entry.ErrorMessage },
  });
  expect(sent).toEqual([
    { operation: 'RemoveTargets', body: { ...targetInput, Ids: ['queue'] } },
    { operation: 'RemoveTargets', body: { ...targetInput, Ids: ['queue'] } },
  ]);
});

it('reads every page, removes all target IDs and then deletes the rule', async () => {
  answer
    .mockResolvedValueOnce(response({ Targets: [{ Id: 'queue', Arn: 'arn:queue' }], NextToken: 'next' }))
    .mockResolvedValueOnce(response({ Targets: [{ Id: 'topic', Arn: 'arn:topic' }] }))
    .mockResolvedValueOnce(response({ FailedEntryCount: 0 }))
    .mockResolvedValueOnce(response({}));
  await drop();
  expect(sent).toEqual([
    { operation: 'ListTargetsByRule', body: targetInput },
    { operation: 'ListTargetsByRule', body: { ...targetInput, NextToken: 'next' } },
    { operation: 'RemoveTargets', body: { ...targetInput, Ids: ['queue', 'topic'] } },
    { operation: 'DeleteRule', body: ruleInput },
  ]);
});

it('deletes a rule without calling RemoveTargets when the read returns no targets', async () => {
  answer.mockResolvedValueOnce(response({ Targets: [] })).mockResolvedValueOnce(response({}));
  await drop();
  expect(sent).toEqual([
    { operation: 'ListTargetsByRule', body: targetInput },
    { operation: 'DeleteRule', body: ruleInput },
  ]);
});

it('stops after a whole refusal to remove targets', async () => {
  answer
    .mockResolvedValueOnce(response({ Targets: [{ Id: 'queue', Arn: 'arn:queue' }] }))
    .mockResolvedValueOnce(refused('Removal refused'));
  await expect(drop()).rejects.toMatchObject({ failure: { operation: 'RemoveTargets', message: 'Removal refused' } });
  expect(sent.map(({ operation }) => operation)).toEqual(['ListTargetsByRule', 'RemoveTargets']);
});

it('keeps the refused delete and says that the targets went', async () => {
  answer
    .mockResolvedValueOnce(response({ Targets: [{ Id: 'queue', Arn: 'arn:queue' }] }))
    .mockResolvedValueOnce(response({ FailedEntryCount: 0 }))
    .mockResolvedValueOnce(refused('Delete refused'));
  await expect(drop()).rejects.toMatchObject({
    failure: { operation: 'DeleteRule', message: 'Delete refused' },
    message: "The rule's targets were removed, but the rule was not deleted.",
  });
  expect(sent.map(({ operation }) => operation)).toEqual(['ListTargetsByRule', 'RemoveTargets', 'DeleteRule']);
});

it('stops after a partial removal and keeps the failed ID, code and message', async () => {
  const entry = { TargetId: 'topic', ErrorCode: 'Refused', ErrorMessage: 'Topic target could not be removed' };
  answer
    .mockResolvedValueOnce(response({ Targets: ['queue', 'topic', 'logs'].map((Id) => ({ Id, Arn: `arn:${Id}` })) }))
    .mockResolvedValueOnce(response({ FailedEntryCount: 1, FailedEntries: [entry] }));
  await expect(drop()).rejects.toMatchObject({
    entries: [entry],
    message: 'Some targets may have been removed.',
  });
  expect(sent).toEqual([
    { operation: 'ListTargetsByRule', body: targetInput },
    { operation: 'RemoveTargets', body: { ...targetInput, Ids: ['queue', 'topic', 'logs'] } },
  ]);
});

it('stops before either mutation when the target read returns 501', async () => {
  answer.mockResolvedValueOnce(response({}, 501));
  await expect(drop()).rejects.toMatchObject({ failure: { operation: 'ListTargetsByRule', kind: 'not-implemented' } });
  expect(sent).toEqual([{ operation: 'ListTargetsByRule', body: targetInput }]);
});
