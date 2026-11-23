import { CloudFormationClient, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { afterEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { listStacks } from './api';

const endpoint = engineEndpoint(9810);
const created = new Date('2026-11-20T01:02:03.000Z');
const complete = {
  StackId: 'id-1',
  StackName: 'Deploy',
  StackStatus: 'CREATE_COMPLETE',
  CreationTime: created,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function read(token?: string) {
  return listStacks(endpoint, token, new AbortController().signal);
}

it('reads a page at a time without status filters and preserves the API order and summary values', async () => {
  const deleted = {
    ...complete,
    StackId: 'id-2',
    StackStatus: 'DELETE_COMPLETE',
    TemplateDescription: 'Template description',
  };
  const send = vi
    .spyOn(CloudFormationClient.prototype, 'send')
    .mockResolvedValueOnce({ StackSummaries: [deleted, complete], NextToken: 'next-page' })
    .mockResolvedValueOnce({ StackSummaries: [complete], NextToken: 'last-page' })
    .mockResolvedValueOnce({ StackSummaries: [] });

  const completeRow = { id: 'id-1', name: 'Deploy', status: 'CREATE_COMPLETE', created, description: undefined };
  await expect(read()).resolves.toEqual({
    items: [
      { id: 'id-2', name: 'Deploy', status: 'DELETE_COMPLETE', created, description: 'Template description' },
      completeRow,
    ],
    next: 'next-page',
  });
  expect(send).toHaveBeenCalledTimes(1);
  await expect(read('next-page')).resolves.toEqual({ items: [completeRow], next: 'last-page' });
  expect(send).toHaveBeenCalledTimes(2);
  const [first, second] = send.mock.calls.map(([command]) => command as ListStacksCommand);
  expect(first).toBeInstanceOf(ListStacksCommand);
  expect(first?.input).toEqual({});
  expect(second).toBeInstanceOf(ListStacksCommand);
  expect(second?.input).toEqual({ NextToken: 'next-page' });
  await expect(read('last-page')).resolves.toEqual({ items: [] });
});

it.each(['StackId', 'StackName', 'StackStatus', 'CreationTime'] as const)(
  'rejects the whole page when %s is missing from one summary',
  async (field) => {
    vi.spyOn(CloudFormationClient.prototype, 'send').mockResolvedValueOnce({
      StackSummaries: [complete, { ...complete, StackId: 'id-2', [field]: undefined }],
    });
    await expect(read()).rejects.toMatchObject({
      failure: { kind: 'other', operation: 'ListStacks', code: 'The emulator returned an incomplete stack summary.' },
    });
  },
);
