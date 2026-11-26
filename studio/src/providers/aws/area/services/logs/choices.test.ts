import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { listLogGroups } from './api';
import { logGroupChoices, logStreamChoices } from './choices';
import { listLogStreams } from './stream-api';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listLogGroups: vi.fn(),
}));
vi.mock('./stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stream-api')>()),
  listLogStreams: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8310';
const groups = vi.mocked(listLogGroups);
const streams = vi.mocked(listLogStreams);
const signal = new AbortController().signal;

beforeEach(() => {
  groups.mockReset();
  streams.mockReset();
});

it('passes the typed substring and page token to the group reader and uses the group name as the value', async () => {
  groups
    .mockResolvedValueOnce({ items: [{ logGroupName: '/app#Group' }, {}], next: 'more' })
    .mockResolvedValueOnce({ items: [{ logGroupName: 'AnotherGroup' }] });
  const source = logGroupChoices(endpoint);
  expect(source.filtering).toBe('sent');
  const first = await source.read(endpoint, 'Group', undefined, signal);
  expect(first).toEqual({ items: ['/app#Group'], next: 'more' });
  await expect(source.read(endpoint, 'Group', first.next, signal)).resolves.toEqual({ items: ['AnotherGroup'] });
  expect(groups.mock.calls).toEqual([
    [endpoint, 'Group', undefined, signal],
    [endpoint, 'Group', 'more', signal],
  ]);
  expect(first.items.map(source.optionOf)).toEqual([{ value: '/app#Group', label: '/app#Group' }]);
});

it('reads stream choices by the selected group and typed prefix and asks nothing without a group', async () => {
  const unready = logStreamChoices(endpoint, undefined);
  expect(unready.ready).toBe(false);
  await unready.read(endpoint, 'a/', undefined, signal);
  expect(streams).not.toHaveBeenCalled();

  streams.mockResolvedValueOnce({ items: [{ logStreamName: 'a/#first' }], next: 'more' });
  const source = logStreamChoices(endpoint, '/app#Group');
  expect(source.ready).toBe(true);
  expect(source.filtering).toBe('sent');
  const page = await source.read(endpoint, 'a/', 'before', signal);
  expect(streams).toHaveBeenCalledWith(endpoint, '/app#Group', 'a/', 'before', signal);
  expect(page.next).toBe('more');
  expect(page.items.map(source.optionOf)).toEqual([{ value: 'a/#first', label: 'a/#first' }]);
});

it.each([
  ['DescribeLogGroups', () => logGroupChoices(endpoint), groups],
  ['DescribeLogStreams', () => logStreamChoices(endpoint, 'group'), streams],
] as const)('passes a failed %s page through to the choice field', async (operation, createSource, reader) => {
  const failure = new RequestError({ kind: 'not-implemented', operation });
  reader.mockRejectedValueOnce(failure);
  const source = createSource();
  expect(source.operation).toBe(operation);
  await expect(source.read(endpoint, '', 'later', signal)).rejects.toBe(failure);
});
